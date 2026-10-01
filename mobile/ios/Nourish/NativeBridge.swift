import Foundation
import os
import UIKit

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
        case "http": return try http(a)
        case "hfToken": return hfToken(a)
        case "download": return try startDownload(a)
        case "cancelDownload":
            let file = a["file"] as? String ?? ""
            DispatchQueue.main.sync { downloads[file]?.cancel() }
            return [String: Any]()
        case "models": return models()
        case "deleteModel": return try deleteModel(a)
        case "generate": return try generate(a)
        case "cancelGenerate": engine.cancel(); return [String: Any]()
        case "keepAwake":
            let on = a["on"] as? Bool ?? false
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
            return [String: Any]()
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

    static func isPublicHost(_ host: String) -> Bool {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { return false }
        defer { freeaddrinfo(result) }
        for info in sequence(first: first, next: { $0.pointee.ai_next }) {
            guard let sa = info.pointee.ai_addr else { continue }
            if Int32(sa.pointee.sa_family) == AF_INET {
                let raw = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr.s_addr }
                if !isPublicV4(UInt32(bigEndian: raw)) { return false }
            } else if Int32(sa.pointee.sa_family) == AF_INET6 {
                let bytes: [UInt8] = sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { p in
                    var addr = p.pointee.sin6_addr
                    return withUnsafeBytes(of: &addr) { Array($0) }
                }
                if bytes.allSatisfy({ $0 == 0 }) || (bytes[0..<15].allSatisfy({ $0 == 0 }) && bytes[15] == 1) { return false }   // :: and ::1
                if bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80 { return false }   // link-local
                if (bytes[0] & 0xfe) == 0xfc || bytes[0] == 0xff { return false }      // private, multicast
                if bytes[0..<10].allSatisfy({ $0 == 0 }) && bytes[10] == 0xff && bytes[11] == 0xff {   // IPv4-mapped
                    let v4 = UInt32(bytes[12]) << 24 | UInt32(bytes[13]) << 16 | UInt32(bytes[14]) << 8 | UInt32(bytes[15])
                    if !isPublicV4(v4) { return false }
                }
            }
        }
        return true
    }

    private static func isPublicV4(_ a: UInt32) -> Bool {
        let first = a >> 24
        if first == 0 || first == 10 || first == 127 || first >= 224 { return false }
        if a >> 16 == 0xA9FE || a >> 16 == 0xC0A8 { return false }      // 169.254/16, 192.168/16
        if a >> 20 == 0xAC1 || a >> 22 == 0x191 { return false }        // 172.16/12, 100.64/10
        return true
    }

    private static func isHuggingFace(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        return host == "huggingface.co" || host.hasSuffix(".huggingface.co")
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
            if publicOnly, !Self.isPublicHost(url.host ?? "") {
                throw BridgeError(message: "That address points to a private network, so it was blocked")
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
            if (300..<400).contains(response.statusCode), let location = response.value(forHTTPHeaderField: "Location"),
               let next = URL(string: location, relativeTo: url)?.absoluteURL {
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
        DispatchQueue.main.sync {
            downloads[file]?.cancel()
            let d = ModelDownload(url: url, file: file, expected: expected, token: UserDefaults.standard.string(forKey: Self.tokenKey)) { [weak self] payload, finished in
                self?.event("download", payload)
                if finished {
                    DispatchQueue.main.async {
                        self?.downloads[file] = nil
                        UIApplication.shared.isIdleTimerDisabled = !(self?.downloads.isEmpty ?? true)
                    }
                }
            }
            downloads[file] = d
            UIApplication.shared.isIdleTimerDisabled = true   // iOS pauses downloads when the phone locks
            d.start()
        }
        return ["started": true]
    }

    // MARK: Running a model

    private func generate(_ a: [String: Any]) throws -> [String: Any] {
        let model = Self.modelsDir.appendingPathComponent(try Self.safeName(a["model"] as? String))
        guard FileManager.default.fileExists(atPath: model.path) else { throw BridgeError(message: "That model isn't downloaded on this phone.") }
        let messages: [(role: String, content: String)] = (a["messages"] as? [[String: Any]] ?? []).map {
            (role: $0["role"] as? String ?? "user", content: $0["content"] as? String ?? "")
        }
        try engine.ensureLoaded(path: model.path, nCtx: a["n_ctx"] as? Int ?? 4096, gpu: a["gpu"] as? Bool ?? true)
        let text = try engine.generate(messages: messages, grammar: a["grammar"] as? String,
                                       temperature: Float(a["temperature"] as? Double ?? 0.7), maxTokens: a["max_tokens"] as? Int ?? 1024)
        return ["text": text, "cancelled": engine.cancelRequested]
    }
}

/// Downloads one model file, resuming a partial download when possible.
final class ModelDownload: NSObject, URLSessionDataDelegate {
    private let url: URL
    private let file: String
    private let expected: Int64
    private let token: String?
    private let report: ([String: Any], Bool) -> Void
    private var session: URLSession?
    private var handle: FileHandle?
    private var received: Int64 = 0
    private var total: Int64 = -1
    private var lastReport = Date.distantPast
    private var failure: String?
    private var cancelled = false

    private var partURL: URL { NativeBridge.modelsDir.appendingPathComponent(file + ".part") }
    private var finalURL: URL { NativeBridge.modelsDir.appendingPathComponent(file) }

    init(url: URL, file: String, expected: Int64, token: String?, report: @escaping ([String: Any], Bool) -> Void) {
        self.url = url
        self.file = file
        self.expected = expected
        self.token = token
        self.report = report
        super.init()
    }

    func start() {
        received = (try? FileManager.default.attributesOfItem(atPath: partURL.path)[.size] as? Int64) ?? 0
        var req = URLRequest(url: url)
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if received > 0 { req.setValue("bytes=\(received)-", forHTTPHeaderField: "Range") }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
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

    // Redirects (Hugging Face → its download servers): checked, and the token is never passed on.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let next = request.url, next.scheme == "https", NativeBridge.isPublicHost(next.host ?? "") else { return completionHandler(nil) }
        var req = request
        let host = next.host?.lowercased() ?? ""
        if !(host == "huggingface.co" || host.hasSuffix(".huggingface.co")) { req.setValue(nil, forHTTPHeaderField: "Authorization") }
        completionHandler(req)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
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
            failure = "Download failed (HTTP \(status))"
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
        session.finishTasksAndInvalidate()
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
        send("done")
    }
}
