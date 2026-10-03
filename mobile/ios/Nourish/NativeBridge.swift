import Foundation
import Network
import os
import UIKit
import UserNotifications

/// What the built-in web app asks the iPhone to do (see ondevice.js): report the phone's specs,
/// fetch web pages and APIs, download models from Hugging Face, and run them with llama.cpp.
/// Calls arrive as {id, cmd, args}; answers and progress events go back through `send`.
final class NativeBridge: NSObject {
    /// Runs JavaScript in the page (always called on the main thread).
    var send: (String) -> Void = { _ in }
    var setMode: (String) -> Void = { _ in }

    private let aiQueue = DispatchQueue(label: "nourish.ai")                     // one model run at a time
    private let workQueue = DispatchQueue(label: "nourish.work", attributes: .concurrent)
    private let engine = LLMEngine()
    private var downloads: [String: ModelDownload] = [:]
    private static let tokenKey = "hf_token"

    static var modelsDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("models", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true   // big, and can be downloaded again
        try? dir.setResourceValues(values)
        return dir
    }

    override init() {
        super.init()
        // Downloads run in ModelDownloads (they can outlive this page, even the app); progress comes here.
        ModelDownloads.shared.log = { [weak self] message, level in self?.log(message, level: level) }
        ModelDownloads.shared.report = { [weak self] payload, _, active in
            self?.event("download", payload)
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = active > 0 }
        }
        ModelDownloads.shared.reconnect()
    }

    /// Where this copy of Nourish runs. Inside LiveContainer the app shares the host app's process,
    /// signature and entitlements, which can change what iOS allows (e.g. background downloads).
    static func environment() -> String {
        let bundle = Bundle.main
        let path = bundle.bundlePath
        let process = ProcessInfo.processInfo.processName
        let executable = bundle.infoDictionary?["CFBundleExecutable"] as? String ?? "?"
        let hints = [
            path.contains("LiveContainer") ? "bundle path mentions LiveContainer" : nil,
            path.contains("/Documents/Applications/") ? "bundle is inside another app's Documents (how LiveContainer stores apps)" : nil,
            bundle.bundleIdentifier != "io.github.nourish.app" ? "bundle ID isn't Nourish's own" : nil,
            process != executable ? "process name \(process) isn't the app's executable \(executable)" : nil,
            ProcessInfo.processInfo.environment.keys.contains { $0.hasPrefix("LC_") } ? "LiveContainer (LC_) settings in the environment" : nil,
        ].compactMap { $0 }
        return "App environment: bundle ID \(bundle.bundleIdentifier ?? "?"), process \(process), bundle path \(path) — "
            + (hints.isEmpty ? "looks like a normally installed app" : "probably inside LiveContainer: " + hints.joined(separator: "; "))
    }

    // MARK: Plumbing

    func handle(id: String, cmd: String, args: [String: Any]) {
        let queue = cmd == "generate" ? aiQueue : workQueue
        queue.async {
            do {
                self.reply(id, ok: true, try self.run(cmd, args))
            } catch {
                self.reply(id, ok: false, ["message": error.localizedDescription])
            }
        }
    }

    private func reply(_ id: String, ok: Bool, _ payload: Any) {
        call("window.__nourishNativeReply && window.__nourishNativeReply.apply(null, \(Self.json([id, ok, payload])))")
    }

    /// A line for Settings → Activity log in the app.
    func log(_ message: String, level: String = "info") {
        call("window.__nourishNativeLog && window.__nourishNativeLog.apply(null, \(Self.json([message, level])))")
    }

    func event(_ name: String, _ payload: [String: Any]) {
        call("window.__nourishNativeEvent && window.__nourishNativeEvent.apply(null, \(Self.json([name, payload])))")
    }

    private func call(_ js: String) {
        DispatchQueue.main.async { self.send(js) }
    }

    static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    private struct BridgeError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func run(_ cmd: String, _ a: [String: Any]) throws -> Any {
        switch cmd {
        case "specs": return specs()
        case "network": return network()
        case "http": return try http(a)
        case "hfToken": return hfToken(a)
        case "download": return try startDownload(a)
        case "cancelDownload":
            let file = a["file"] as? String ?? ""
            ModelDownloads.shared.cancel(file)
            return [String: Any]()
        case "downloadCheck":
            guard let url = URL(string: a["url"] as? String ?? ""), Self.isHuggingFace(url) else { throw BridgeError(message: "Give a Hugging Face file address") }
            return DownloadCheck.run(source: url, target: nil, token: UserDefaults.standard.string(forKey: Self.tokenKey), label: url.lastPathComponent,
                                     log: { [weak self] message, level in self?.log(message, level: level) }).report
        case "models": return models()
        case "deleteModel": return try deleteModel(a)
        case "generate": return try generate(a)
        case "cancelGenerate": engine.cancel(); return [String: Any]()
        case "keepAwake":
            let on = a["on"] as? Bool ?? false
            DispatchQueue.main.async {
                if UIApplication.shared.isIdleTimerDisabled != on { self.log("Screen stays on: \(on ? "yes" : "no")", level: "debug") }
                UIApplication.shared.isIdleTimerDisabled = on
            }
            return [String: Any]()
        case "notify": return notify(a)
        case "ocr":
            let started = Date()
            let result = try TextReader.read(base64: a["image"] as? String ?? "")
            log("Read \(result["lines"] ?? 0) lines of text from a \(result["width"] ?? 0)×\(result["height"] ?? 0) picture in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
            return result
        case "barcode": return try TextReader.barcode(base64: a["image"] as? String ?? "")
        case "appIcon":
            // Settings → Appearance → App icon. "default" is the main icon; the others are the
            // AppIcon-<Name> sets in Assets.xcassets.
            let name = a["name"] as? String ?? "default"
            let icon: String? = name == "default" ? nil : "AppIcon-" + name.prefix(1).uppercased() + name.dropFirst()
            let done = DispatchSemaphore(value: 0)
            var failure: Error?
            DispatchQueue.main.async {
                guard UIApplication.shared.supportsAlternateIcons else { failure = BridgeError(message: "This iPhone can't change app icons."); done.signal(); return }
                if UIApplication.shared.alternateIconName == icon { done.signal(); return }
                UIApplication.shared.setAlternateIconName(icon) { error in failure = error; done.signal() }
            }
            _ = done.wait(timeout: .now() + 20)
            if let failure = failure { throw failure }
            return ["icon": name]
        case "library":
            switch a["op"] as? String ?? "" {
            case "list": return RecipeLibrary.list()
            case "read": return try RecipeLibrary.read(a["path"] as? String ?? "")
            case "open": return RecipeLibrary.open()
            case "add": return try RecipeLibrary.pick()
            case "where": return RecipeLibrary.location()
            default: throw BridgeError(message: "Unknown recipe library request.")
            }
        case "setMode":
            let mode = a["mode"] as? String ?? "local"
            DispatchQueue.main.async { self.setMode(mode) }
            return [String: Any]()
        default: throw BridgeError(message: "Unknown command: \(cmd)")
        }
    }

    // MARK: Specs

    private static func machineId() -> String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return sim }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
    }

    private static let deviceNames: [String: String] = [
        "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max", "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13",
        "iPhone14,6": "iPhone SE (3rd gen)", "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus",
        "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max", "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus",
        "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
        "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
    ]

    /// Wi-Fi or cellular, so the recipe library only refreshes in the background on Wi-Fi.
    private func network() -> [String: Any] {
        let monitor = NWPathMonitor()
        let ready = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var current: NWPath?
        monitor.pathUpdateHandler = { path in
            lock.lock(); defer { lock.unlock() }
            if current == nil { current = path; ready.signal() }
        }
        monitor.start(queue: DispatchQueue(label: "nourish.network"))
        _ = ready.wait(timeout: .now() + 2)
        monitor.cancel()
        lock.lock(); let path = current; lock.unlock()
        guard let p = path else { return ["known": false] }
        return ["known": true, "online": p.status == .satisfied,
                "wifi": p.usesInterfaceType(.wifi) || p.usesInterfaceType(.wiredEthernet),
                "expensive": p.isExpensive, "constrained": p.isConstrained]
    }

    private func specs() -> [String: Any] {
        let id = Self.machineId()
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let free = (try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage ?? 0
        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "nominal"
        }
        #if targetEnvironment(simulator)
        let simulator = true
        #else
        let simulator = false
        #endif
        let device = Self.deviceNames[id] ?? (id.hasPrefix("iPhone") ? "iPhone (\(id))" : UIDevice.current.model)
        return [
            "platform": "ios",
            "device": device + (simulator ? " (simulator)" : ""),
            "model_id": id,
            "environment": Self.environment(),
            // Cups and °F only where the phone is set to the US system; the UK cooks in metric.
            "measurement": Locale.current.measurementSystem == .us ? "imperial" : "metric",
            "ram": Int64(ProcessInfo.processInfo.physicalMemory),
            // What iOS lets this app use right now; includes a raised limit (e.g. LiveContainer with more RAM).
            "usable": Int64(os_proc_available_memory()),
            "disk_free": Int64(free),
            "cores": ProcessInfo.processInfo.activeProcessorCount,
            "thermal": thermal,
            "gpu": !simulator,
            "simulator": simulator,
            "os": "iOS \(UIDevice.current.systemVersion)",
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?",
        ]
    }

    // MARK: Web requests (home-network addresses blocked, every redirect checked)

    /// nil when every address the host has is on the public internet; otherwise why not. A failed
    /// lookup is retried (it can fail briefly on a flaky network) and reported as such, not as private.
    static func hostProblem(_ host: String) -> String? {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        var rc: Int32 = -1
        for attempt in 0..<3 {
            rc = getaddrinfo(host, nil, &hints, &result)
            if rc == 0 { break }
            if attempt < 2 { Thread.sleep(forTimeInterval: 0.5 * Double(attempt + 1)) }
        }
        guard rc == 0, let first = result else {
            return "Couldn't look up \(host) (\(String(cString: gai_strerror(rc)))). Check the internet connection."
        }
        defer { freeaddrinfo(result) }
        for info in sequence(first: first, next: { $0.pointee.ai_next }) {
            guard let sa = info.pointee.ai_addr else { continue }
            var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(sa, info.pointee.ai_addrlen, &name, socklen_t(name.count), nil, 0, NI_NUMERICHOST)
            let blocked = "\(host) points to \(String(cString: name)), a private or blocked address, so it was blocked. (An ad blocker, VPN or DNS filter can do this.)"
            if Int32(sa.pointee.sa_family) == AF_INET {
                let raw = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
                if !isPublicV4(UInt32(bigEndian: raw)) { return blocked }
            } else if Int32(sa.pointee.sa_family) == AF_INET6 {
                let bytes: [UInt8] = sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { p in
                    var addr = p.pointee.sin6_addr
                    return withUnsafeBytes(of: &addr) { Array($0) }
                }
                if bytes.allSatisfy({ $0 == 0 }) || (bytes[0..<15].allSatisfy({ $0 == 0 }) && bytes[15] == 1) { return blocked }   // :: and ::1
                if bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80 { return blocked }   // link-local
                if (bytes[0] & 0xfe) == 0xfc || bytes[0] == 0xff { return blocked }      // private, multicast
                if bytes[0..<10].allSatisfy({ $0 == 0 }) && bytes[10] == 0xff && bytes[11] == 0xff {   // IPv4-mapped
                    let v4 = UInt32(bytes[12]) << 24 | UInt32(bytes[13]) << 16 | UInt32(bytes[14]) << 8 | UInt32(bytes[15])
                    if !isPublicV4(v4) { return blocked }
                }
            }
        }
        return nil
    }

    private static func isPublicV4(_ a: UInt32) -> Bool {
        let first = a >> 24
        if first == 0 || first == 10 || first == 127 || first >= 224 { return false }
        if a >> 16 == 0xA9FE || a >> 16 == 0xC0A8 { return false }      // 169.254/16, 192.168/16
        if a >> 20 == 0xAC1 || a >> 22 == 0x191 { return false }        // 172.16/12, 100.64/10
        return true
    }

    static func isHuggingFace(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        return host == "huggingface.co" || host.hasSuffix(".huggingface.co")
    }

    /// Turns a redirect's Location header into an address iOS accepts. Download servers sometimes
    /// send characters that aren't allowed in a web address (spaces, quotes, a lone "%"); those are
    /// percent-encoded here, which is what a browser does. Only https is followed.
    static func redirectTarget(_ location: String, from base: URL) -> (url: URL, fixed: Int)? {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#@!$&'()*+,;=".unicodeScalars)
        let hex = Set("0123456789ABCDEFabcdef".unicodeScalars)
        let chars = Array(location.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars)
        var cleaned = String.UnicodeScalarView()
        var fixed = 0
        for (i, c) in chars.enumerated() {
            let validPercent = c == "%" && i + 2 < chars.count && hex.contains(chars[i + 1]) && hex.contains(chars[i + 2])
            if allowed.contains(c) || validPercent {
                cleaned.append(c)
            } else {
                fixed += 1
                for byte in String(c).utf8 { cleaned.append(contentsOf: String(format: "%%%02X", byte).unicodeScalars) }
            }
        }
        guard let next = URL(string: String(cleaned), relativeTo: base)?.absoluteURL,
              next.scheme?.lowercased() == "https", next.host != nil else { return nil }
        return (next, fixed)
    }

    /// An address for the activity log: host, path and the names of its query parts, without
    /// their values (download links carry a signature that shouldn't be shared).
    static func describe(_ url: URL) -> String {
        let keys = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name) ?? []
        let path = url.path.count > 60 ? String(url.path.prefix(57)) + "…" : url.path
        return "\(url.host ?? "?")\(path)" + (keys.isEmpty ? "" : " (query: \(keys.joined(separator: ", ")))")
    }

    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)   // handled one hop at a time below
        }
    }
    private let httpSession = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)

    private func http(_ a: [String: Any]) throws -> [String: Any] {
        guard var url = URL(string: a["url"] as? String ?? ""), ["http", "https"].contains(url.scheme ?? "") else {
            throw BridgeError(message: "Only web addresses are allowed")
        }
        var method = a["method"] as? String ?? "GET"
        var body = (a["body"] as? String)?.data(using: .utf8)
        let headers = a["headers"] as? [String: String] ?? [:]
        let timeout = (a["timeoutMs"] as? Double ?? 20000) / 1000
        let maxBytes = a["maxBytes"] as? Int ?? 4 * 1024 * 1024
        let publicOnly = a["publicOnly"] as? Bool ?? true
        let useToken = (a["auth"] as? String) == "hf"
        for _ in 0..<6 {
            if publicOnly, let problem = Self.hostProblem(url.host ?? "") {
                throw BridgeError(message: problem)
            }
            var req = URLRequest(url: url, timeoutInterval: timeout)
            req.httpMethod = method
            req.httpBody = body
            for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
            // The Hugging Face token only ever goes to Hugging Face.
            if useToken, Self.isHuggingFace(url), let token = UserDefaults.standard.string(forKey: Self.tokenKey) {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            let (data, response) = try syncRequest(req)
            if (300..<400).contains(response.statusCode), let location = response.value(forHTTPHeaderField: "Location") {
                guard let next = Self.redirectTarget(location, from: url)?.url else {
                    throw BridgeError(message: "The server redirected to an address that couldn't be used")
                }
                url = next
                if response.statusCode != 307 && response.statusCode != 308 { method = "GET"; body = nil }
                continue
            }
            let text = String(decoding: data.prefix(maxBytes), as: UTF8.self)
            return ["status": response.statusCode, "url": url.absoluteString, "body": text]
        }
        throw BridgeError(message: "Too many redirects")
    }

    private func syncRequest(_ req: URLRequest) throws -> (Data, HTTPURLResponse) {
        let done = DispatchSemaphore(value: 0)
        var out: (Data, HTTPURLResponse)?
        var failure: Error?
        httpSession.dataTask(with: req) { data, response, error in
            if let response = response as? HTTPURLResponse { out = (data ?? Data(), response) } else { failure = error ?? URLError(.badServerResponse) }
            done.signal()
        }.resume()
        done.wait()
        if let out { return out }
        throw failure ?? URLError(.unknown)
    }

    // MARK: Hugging Face token

    private func hfToken(_ a: [String: Any]) -> [String: Any] {
        switch a["action"] as? String {
        case "set": UserDefaults.standard.set((a["token"] as? String ?? "").trimmingCharacters(in: .whitespaces), forKey: Self.tokenKey)
        case "clear": UserDefaults.standard.removeObject(forKey: Self.tokenKey)
        default: break
        }
        return ["set": UserDefaults.standard.string(forKey: Self.tokenKey) != nil]
    }

    // MARK: Models on disk

    private static func safeName(_ file: String?) throws -> String {
        guard let file, file.range(of: "^[A-Za-z0-9._-]{1,200}\\.gguf$", options: .regularExpression) != nil else {
            throw BridgeError(message: "Not a model file name")
        }
        return file
    }

    private func models() -> [String: Any] {
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.modelsDir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        let list: [[String: Any]] = files.filter { $0.pathExtension == "gguf" }.map {
            ["file": $0.lastPathComponent, "size": (try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0]
        }
        return ["files": list]
    }

    private func deleteModel(_ a: [String: Any]) throws -> [String: Any] {
        let url = Self.modelsDir.appendingPathComponent(try Self.safeName(a["file"] as? String))
        aiQueue.sync { if engine.isLoaded(path: url.path) { engine.unload() } }
        try? FileManager.default.removeItem(at: url)
        return [:]
    }

    // MARK: Downloads

    private func startDownload(_ a: [String: Any]) throws -> [String: Any] {
        let file = try Self.safeName(a["file"] as? String)
        guard let url = URL(string: a["url"] as? String ?? ""), Self.isHuggingFace(url) else {
            throw BridgeError(message: "Models can only be downloaded from Hugging Face")
        }
        let expected = (a["size"] as? NSNumber)?.int64Value ?? -1
        ModelDownloads.shared.start(url: url, file: file, expected: expected, token: UserDefaults.standard.string(forKey: Self.tokenKey),
                                    chunked: (a["mode"] as? String) == "chunked")
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
        return ["started": true]
    }

    // MARK: Running a model

    /// Runs the model. Wrapped in an iOS background task: when Nourish leaves the screen mid-answer,
    /// iOS allows a short extra time (logged every 5 s as "background time left"); when that runs out
    /// the answer is stopped and reported as `suspended`, and the page asks again once Nourish is back.
    /// The graphics chip can't be used in the background at all; a GPU failure there (code -3) is
    /// also reported as `suspended`. A GPU failure on screen is retried once on the processor.
    private func generate(_ a: [String: Any]) throws -> [String: Any] {
        let model = Self.modelsDir.appendingPathComponent(try Self.safeName(a["model"] as? String))
        guard FileManager.default.fileExists(atPath: model.path) else { throw BridgeError(message: "That model isn't downloaded on this phone.") }
        let messages: [(role: String, content: String)] = (a["messages"] as? [[String: Any]] ?? []).map {
            (role: $0["role"] as? String ?? "user", content: $0["content"] as? String ?? "")
        }
        let nCtx = a["n_ctx"] as? Int ?? 4096
        var gpu = a["gpu"] as? Bool ?? true
        try load(model, nCtx: nCtx, gpu: gpu)

        var expired = false
        let task = BackgroundWindow(name: "Nourish AI", log: { [weak self] in self?.log($0, level: $1) }) { [weak self] in
            expired = true
            self?.engine.cancel()
            Self.postNotification(title: "Nourish paused", body: "iOS paused Nourish while it was working. Open Nourish to continue.")
        }
        defer { task.end() }

        let genStart = Date()
        defer { log(String(format: "Generated in %.1f s%@", Date().timeIntervalSince(genStart), engine.cancelRequested ? " (stopped)" : ""), level: "debug") }
        for attempt in 0..<2 {
            do {
                let text = try engine.generate(messages: messages, grammar: a["grammar"] as? String,
                                               temperature: Float(a["temperature"] as? Double ?? 0.7), maxTokens: a["max_tokens"] as? Int ?? 1024)
                if expired { log("Answer stopped: iOS ended Nourish's background time", level: "warn") }
                return ["text": text, "cancelled": engine.cancelRequested, "suspended": expired]
            } catch {
                let message = error.localizedDescription
                let gpuFailure = message.contains("(code -3)") || message.contains("(code -2)")
                let active = Self.appIsActive()
                log("Generation failed: \(message) (app \(active ? "on screen" : "in the background"), graphics chip \(gpu ? "on" : "off"), memory available \(os_proc_available_memory() / 1_048_576) MB)", level: "warn")
                if gpuFailure && (!active || expired) {
                    // iOS doesn't let apps use the graphics chip in the background.
                    return ["text": "", "cancelled": true, "suspended": true]
                }
                if gpuFailure && gpu && attempt == 0 {
                    log("The graphics chip failed while Nourish was on screen; trying again on the processor", level: "warn")
                    gpu = false
                    try load(model, nCtx: nCtx, gpu: false)
                    continue
                }
                if gpuFailure {
                    throw BridgeError(message: "The phone couldn't run the model (\(message.contains("-2") ? "out of graphics memory" : "graphics chip error")). Close other apps and try again, or pick a smaller model.")
                }
                throw error
            }
        }
        throw BridgeError(message: "The model couldn't answer.")
    }

    private func load(_ model: URL, nCtx: Int, gpu: Bool) throws {
        let loadStart = Date()
        let wasLoaded = engine.isLoaded(path: model.path)
        do {
            try engine.ensureLoaded(path: model.path, nCtx: nCtx, gpu: gpu)
        } catch {
            log("Loading \(model.lastPathComponent) failed: \(error.localizedDescription) (memory available: \(os_proc_available_memory() / 1_048_576) MB)", level: "error")
            throw error
        }
        if !wasLoaded || Date().timeIntervalSince(loadStart) > 0.5 {
            log(String(format: "Loaded %@ in %.1f s (graphics chip %@, memory still available: %ld MB)", model.lastPathComponent, Date().timeIntervalSince(loadStart), gpu ? "on" : "off", os_proc_available_memory() / 1_048_576))
        }
    }

    static func appIsActive() -> Bool {
        if Thread.isMainThread { return UIApplication.shared.applicationState == .active }
        return DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
    }

    // MARK: Notifications

    /// {permission: true} asks once; {title, body} shows a notification now.
    private func notify(_ a: [String: Any]) -> [String: Any] {
        if a["permission"] as? Bool == true {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] granted, error in
                self?.log("Notifications \(granted ? "allowed" : "not allowed")\(error.map { ": \($0.localizedDescription)" } ?? "")", level: "debug")
            }
            return [:]
        }
        Self.postNotification(title: a["title"] as? String ?? "Nourish", body: a["body"] as? String ?? "")
        return [:]
    }

    static func postNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

/// An iOS background task around one piece of work, with the time iOS still allows written to the
/// activity log every 5 s while Nourish is off screen. `end()` must be called (it's idempotent).
final class BackgroundWindow {
    private var id: UIBackgroundTaskIdentifier = .invalid
    private var timer: DispatchSourceTimer?
    private let lock = NSLock()
    private var ended = false

    init(name: String, log: @escaping (String, String) -> Void, expired: @escaping () -> Void) {
        let begin = {
            self.id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
                log(String(format: "iOS is ending Nourish's background time now (%.0f s left)", UIApplication.shared.backgroundTimeRemaining), "warn")
                expired()
                self?.end()
            }
        }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 5, repeating: 5)
        var last = ""
        timer.setEventHandler {
            // Written only when something changed, so a long answer doesn't fill the log.
            let app = UIApplication.shared
            let state = app.applicationState == .active ? "on screen" : app.applicationState == .background ? "in the background" : "inactive (switching apps or locked)"
            let left = app.backgroundTimeRemaining
            let line = app.applicationState == .active ? "Nourish is on screen"
                : left > 100_000 ? "Nourish is \(state); iOS hasn't set a time limit"
                : String(format: "Nourish is %@: %.0f s of background time left", state, (left / 5).rounded() * 5)
            if line != last { log(line, "info"); last = line }
        }
        timer.resume()
        self.timer = timer
    }

    func end() {
        lock.lock(); defer { lock.unlock() }
        guard !ended else { return }
        ended = true
        timer?.cancel()
        let id = self.id
        DispatchQueue.main.async { if id != .invalid { UIApplication.shared.endBackgroundTask(id) } }
    }
}

/// Downloads one model file, resuming a partial download when possible.
final class ModelDownload: NSObject, URLSessionDataDelegate {
    private let url: URL
    private let file: String
    private let expected: Int64
    private let token: String?
    private let report: ([String: Any], Bool) -> Void
    private let log: (String, String) -> Void
    private var session: URLSession?
    private var startedAt = Date()
    private var handle: FileHandle?
    private var received: Int64 = 0
    private var total: Int64 = -1
    private var lastReport = Date.distantPast
    private var failure: String?
    private var cancelled = false
    private var hops = 0
    private var pendingRedirect: URL?

    private var partURL: URL { NativeBridge.modelsDir.appendingPathComponent(file + ".part") }
    private var finalURL: URL { NativeBridge.modelsDir.appendingPathComponent(file) }

    init(url: URL, file: String, expected: Int64, token: String?, log: @escaping (String, String) -> Void, report: @escaping ([String: Any], Bool) -> Void) {
        self.url = url
        self.file = file
        self.expected = expected
        self.token = token
        self.log = log
        self.report = report
        super.init()
    }

    func start() {
        received = (try? FileManager.default.attributesOfItem(atPath: partURL.path)[.size] as? Int64) ?? 0
        startedAt = Date()
        log("Download \(file): starting\(received > 0 ? " (resuming from \(received) bytes)" : "")\(token != nil ? " with Hugging Face sign-in" : "")", "info")
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        request(url)
    }

    /// One request. Redirects come back here one at a time (see below) so each address can be
    /// checked and cleaned up first, and the Hugging Face token only ever goes to Hugging Face.
    private func request(_ target: URL) {
        var req = URLRequest(url: target)
        if let token, NativeBridge.isHuggingFace(target) { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if received > 0 { req.setValue("bytes=\(received)-", forHTTPHeaderField: "Range") }
        log("Download \(file): GET \(NativeBridge.describe(target))", "info")
        session?.dataTask(with: req).resume()
    }

    func cancel() {
        cancelled = true
        session?.invalidateAndCancel()
    }

    private func send(_ state: String, _ error: String? = nil) {
        var p: [String: Any] = ["file": file, "received": received, "total": total > 0 ? total : expected, "state": state]
        if let error { p["error"] = error }
        report(p, state != "running")
    }

    // Redirects (Hugging Face → its download servers) aren't followed automatically: the redirect
    // response arrives below and is handled there.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        log("Download \(file): server answered HTTP \(status) from \(response.url?.host ?? "?"), size \(response.expectedContentLength) bytes", status >= 400 ? "warn" : "info")
        switch status {
        case 301, 302, 303, 307, 308:
            let location = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location") ?? ""
            hops += 1
            if hops > 8 {
                failure = "The download was redirected too many times, so it was stopped."
            } else if let base = response.url ?? dataTask.originalRequest?.url, let next = NativeBridge.redirectTarget(location, from: base) {
                log("Download \(file): redirected (HTTP \(status)) to \(NativeBridge.describe(next.url))\(next.fixed > 0 ? ", fixed \(next.fixed) character(s) iOS doesn't accept" : "")", "info")
                pendingRedirect = next.url   // started once this request has closed (didCompleteWithError)
            } else {
                log("Download \(file): unusable redirect address (\(location.count) characters, starts \"\(location.prefix(40))\")", "error")
                failure = location.isEmpty ? "Download failed (HTTP \(status) without an address)"
                    : "The download was redirected to an address that couldn't be used, so it was stopped."
            }
            completionHandler(.cancel)
        case 200, 206:
            if status == 200 { received = 0 }   // the server ignored the resume request: start over
            if !FileManager.default.fileExists(atPath: partURL.path) || status == 200 {
                FileManager.default.createFile(atPath: partURL.path, contents: nil)
            }
            handle = try? FileHandle(forWritingTo: partURL)
            if status == 206 { _ = handle?.seekToEndOfFile() }
            let length = response.expectedContentLength
            total = expected > 0 ? expected : (length > 0 ? length + received : -1)
            completionHandler(handle == nil ? .cancel : .allow)
        case 401, 403:
            failure = "Hugging Face refused the download. This model may need you to sign in and accept its licence."
            completionHandler(.cancel)
        case 416:
            try? FileManager.default.removeItem(at: partURL)
            failure = "The download had to restart. Tap Download again."
            completionHandler(.cancel)
        default:
            let location = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location").flatMap { URL(string: $0)?.host } ?? ""
            failure = "Download failed (HTTP \(status)\(location.isEmpty ? "" : ", sent to " + location))"
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        handle?.write(data)
        received += Int64(data.count)
        if Date().timeIntervalSince(lastReport) > 0.4 {
            lastReport = Date()
            send("running")
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        if let next = pendingRedirect, !cancelled {
            pendingRedirect = nil
            return request(next)
        }
        session.finishTasksAndInvalidate()
        if let error, !cancelled { log("Download \(file): connection error after \(received) bytes: \(error.localizedDescription)", "warn") }
        if cancelled { return send("cancelled") }
        if let failure { return send("error", failure) }
        if let error { return send("error", "\(error.localizedDescription) Tap Download to continue.") }
        let size = (try? FileManager.default.attributesOfItem(atPath: partURL.path)[.size] as? Int64) ?? 0
        if expected > 0, size != expected { return send("error", "The download was incomplete. Tap Download to continue it.") }
        guard let head = try? FileHandle(forReadingFrom: partURL), head.readData(ofLength: 4) == Data("GGUF".utf8) else {
            try? FileManager.default.removeItem(at: partURL)
            return send("error", "That file isn't a GGUF model.")
        }
        try? head.close()
        try? FileManager.default.removeItem(at: finalURL)
        do {
            try FileManager.default.moveItem(at: partURL, to: finalURL)
        } catch {
            return send("error", "Couldn't save the model.")
        }
        received = size
        let secs = max(Date().timeIntervalSince(startedAt), 0.1)
        log(String(format: "Download %@: finished, %lld bytes in %.0f s (%.1f MB/s)", file, size, secs, Double(size) / secs / 1_048_576), "info")
        send("done")
    }
}
