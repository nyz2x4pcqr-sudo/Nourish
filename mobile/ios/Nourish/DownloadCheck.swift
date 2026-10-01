import Foundation
import Network

/// Works out why a model download gets no data, and writes every finding to the activity log.
/// Runs on its own when a download fails before its first byte, and from Settings → Activity log →
/// "Check download connection". Blocks the calling thread (up to about a minute); never call it on main.
///
/// 1. The network iOS says it is using (Wi-Fi/cellular, Low Data Mode, VPN, proxy).
/// 2. Where Hugging Face redirects the file to, and whether that address is a valid URL.
/// 3. DNS for the download server and for huggingface.co (an ad blocker or DNS filter shows up as
///    0.0.0.0 / 127.0.0.1, or as no answer).
/// 4. A HEAD and a 1 MB GET of the download address with a bare URLSession.shared (no custom settings).
/// 5. The same with "?download=true", in case Hugging Face hands out a different server for it.
enum DownloadCheck {
    struct Outcome {
        var plainWorks = false          // a bare URLSession got data from the download address
        var alternate: URL?             // a different download address that worked
        var advice = ""                 // one sentence for the person
        var report: [String: Any] = [:] // for the "downloadCheck" bridge command and the CI test
    }

    static func run(source: URL, target known: URL?, token: String?, label: String, log: @escaping (String, String) -> Void) -> Outcome {
        var out = Outcome()
        let say = { (text: String, level: String) in log("Download check (\(label)): \(text)", level) }

        // 1. The network.
        let path = pathDescription()
        say("network: \(path.text)", "info")
        say("proxy/VPN: \(proxyDescription())", "info")
        out.report["network"] = path.text

        // 2. Where the file is.
        var target = known
        if target == nil {
            let (response, _, error, ms) = request(noRedirects, head(source, token: token))
            if let location = response?.value(forHTTPHeaderField: "Location"), let next = NativeBridge.redirectTarget(location, from: source) {
                target = next.url
                say("huggingface.co answered HTTP \(response?.statusCode ?? 0) in \(ms) ms, redirect to \(next.url.host ?? "?")", "info")
            } else {
                say("couldn't get the download address from huggingface.co: HTTP \(response?.statusCode ?? 0)\(error.map { ", " + ModelDownloads.describe($0 as NSError) } ?? "")", "warn")
            }
        }
        guard let target else {
            out.advice = "Hugging Face itself couldn't be reached."
            return out
        }
        let full = target.absoluteString
        say("download address: \(full.count) characters, URL(string:) \(URL(string: full) == nil ? "FAILS" : "OK"): \(ModelDownloads.redact(full))", URL(string: full) == nil ? "error" : "info")
        out.report["address_length"] = full.count

        // 3. DNS.
        let host = target.host ?? ""
        var cdnBlocked = false
        for name in [host, "huggingface.co"] where !name.isEmpty {
            let (addresses, error) = lookup(name)
            let sinkhole = !addresses.isEmpty && addresses.allSatisfy { $0 == "0.0.0.0" || $0 == "::" || $0.hasPrefix("127.") || $0 == "::1" }
            if name == host, addresses.isEmpty || sinkhole { cdnBlocked = true }
            say("DNS \(name): \(error ?? addresses.joined(separator: ", "))\(sinkhole ? " ← blocked (an ad blocker, VPN or DNS filter on this phone or network)" : "")",
                error != nil || sinkhole ? "warn" : "info")
            out.report["dns_" + name] = error ?? addresses.joined(separator: ", ")
        }

        // 4. Bare URLSession.shared, no custom configuration.
        let (headResponse, _, headError, headMs) = request(.shared, URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15).with(method: "HEAD"))
        say("HEAD download address (URLSession.shared): \(headResponse.map { "HTTP \($0.statusCode)" } ?? "no answer")\(headError.map { ", " + ModelDownloads.describe($0 as NSError) } ?? "") in \(headMs) ms",
            headResponse == nil ? "warn" : "info")
        out.report["head"] = headResponse?.statusCode ?? -1
        var range = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        range.setValue("bytes=0-1048575", forHTTPHeaderField: "Range")
        let (getResponse, data, getError, getMs) = request(.shared, range)
        let bytes = data?.count ?? 0
        out.plainWorks = (200..<300).contains(getResponse?.statusCode ?? 0) && bytes > 0
        say("GET first 1 MB (URLSession.shared): \(getResponse.map { "HTTP \($0.statusCode)" } ?? "no answer"), \(bytes) bytes in \(getMs) ms\(getError.map { ", " + ModelDownloads.describe($0 as NSError) } ?? "")",
            out.plainWorks ? "info" : "warn")
        out.report["get_bytes"] = bytes
        out.report["get_status"] = getResponse?.statusCode ?? -1

        // 5. "?download=true" may redirect somewhere else.
        if !out.plainWorks, var parts = URLComponents(url: source, resolvingAgainstBaseURL: false) {
            parts.queryItems = (parts.queryItems ?? []) + [URLQueryItem(name: "download", value: "true")]
            if let alt = parts.url {
                let (response, _, _, _) = request(noRedirects, head(alt, token: token))
                if let location = response?.value(forHTTPHeaderField: "Location"), let next = NativeBridge.redirectTarget(location, from: alt) {
                    var probe = URLRequest(url: next.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
                    probe.setValue("bytes=0-65535", forHTTPHeaderField: "Range")
                    let (r, d, e, ms) = request(.shared, probe)
                    let ok = (200..<300).contains(r?.statusCode ?? 0) && (d?.count ?? 0) > 0
                    say("with ?download=true: redirect to \(next.url.host ?? "?") (\(next.url.absoluteString.count) characters), GET \(r.map { "HTTP \($0.statusCode)" } ?? "no answer"), \(d?.count ?? 0) bytes in \(ms) ms\(e.map { ", " + ModelDownloads.describe($0 as NSError) } ?? "")",
                        ok ? "info" : "warn")
                    if ok { out.alternate = next.url }
                }
            }
        }

        if out.plainWorks {
            out.advice = "The download server answers a plain request, so the app will retry that way."
        } else if out.alternate != nil {
            out.advice = "A second download address works, so the app will retry with it."
        } else if cdnBlocked {
            out.advice = "This phone can't look up Hugging Face's download server (\(host)). An ad blocker, VPN, DNS filter or Screen Time limit may be blocking it: allow \(host), or turn the blocker off while downloading."
        } else {
            out.advice = "This phone can reach huggingface.co but not its download server (\(host)). A VPN, ad blocker, firewall or network filter may be blocking it."
        }
        say(out.advice, out.plainWorks || out.alternate != nil ? "info" : "error")
        out.report["advice"] = out.advice
        return out
    }

    // MARK: Helpers

    private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
    private static let noRedirects = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private static func head(_ url: URL, token: String?) -> URLRequest {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.httpMethod = "HEAD"
        if let token, NativeBridge.isHuggingFace(url) { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private static func request(_ session: URLSession, _ req: URLRequest) -> (HTTPURLResponse?, Data?, Error?, Int) {
        let done = DispatchSemaphore(value: 0)
        let started = Date()
        var out: (HTTPURLResponse?, Data?, Error?) = (nil, nil, nil)
        session.dataTask(with: req) { data, response, error in
            out = (response as? HTTPURLResponse, data, error)
            done.signal()
        }.resume()
        if done.wait(timeout: .now() + req.timeoutInterval + 5) == .timedOut {
            out.2 = URLError(.timedOut)
        }
        return (out.0, out.1, out.2, Int(Date().timeIntervalSince(started) * 1000))
    }

    private static func pathDescription() -> (text: String, path: NWPath?) {
        let monitor = NWPathMonitor()
        let ready = DispatchSemaphore(value: 0)
        var current: NWPath?
        monitor.pathUpdateHandler = { path in
            if current == nil { current = path; ready.signal() }
        }
        monitor.start(queue: DispatchQueue(label: "nourish.path"))
        _ = ready.wait(timeout: .now() + 3)
        monitor.cancel()
        guard let path = current else { return ("no answer from NWPathMonitor", nil) }
        let kinds: [(NWInterface.InterfaceType, String)] = [(.wifi, "Wi-Fi"), (.cellular, "cellular"), (.wiredEthernet, "wired"), (.loopback, "loopback"), (.other, "other")]
        let using = kinds.filter { path.usesInterfaceType($0.0) }.map { $0.1 }
        let interfaces = path.availableInterfaces.map { "\($0.name) (\($0.type))" }.joined(separator: ", ")
        return ("status \(path.status), using \(using.isEmpty ? "?" : using.joined(separator: " + ")), isExpensive \(path.isExpensive), isConstrained (Low Data Mode) \(path.isConstrained), DNS \(path.supportsDNS), IPv4 \(path.supportsIPv4), IPv6 \(path.supportsIPv6), interfaces: \(interfaces)", path)
    }

    private static func proxyDescription() -> String {
        guard let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any] else { return "unknown" }
        let scoped = (settings["__SCOPED__"] as? [String: Any])?.keys.sorted() ?? []
        let vpn = scoped.filter { key in ["tun", "tap", "ppp", "ipsec"].contains { key.contains($0) } }
        let https = (settings["HTTPSEnable"] as? Int ?? 0) == 1 ? "on (\(String(describing: settings["HTTPSProxy"] ?? "?")))" : "off"
        let pac = (settings["ProxyAutoConfigEnable"] as? Int ?? 0) == 1 ? "on" : "off"
        return "VPN \(vpn.isEmpty ? "none seen" : vpn.joined(separator: ", ")), HTTPS proxy \(https), auto-config \(pac)"
    }

    /// The addresses DNS gives for a host (numeric), or the error.
    private static func lookup(_ host: String) -> ([String], String?) {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        let rc = getaddrinfo(host, "443", &hints, &result)
        guard rc == 0, let first = result else { return ([], "lookup failed: \(String(cString: gai_strerror(rc)))") }
        defer { freeaddrinfo(result) }
        var addresses: [String] = []
        for entry in sequence(first: first, next: { $0.pointee.ai_next }) {
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(entry.pointee.ai_addr, entry.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                let address = String(cString: buffer)
                if !addresses.contains(address) { addresses.append(address) }
            }
        }
        return (addresses, nil)
    }
}

private extension URLRequest {
    func with(method: String) -> URLRequest {
        var copy = self
        copy.httpMethod = method
        return copy
    }
}
