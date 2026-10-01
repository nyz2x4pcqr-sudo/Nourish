import Foundation

/// Model downloads (0.1–5 GB files from Hugging Face).
///
/// 1. Ask Hugging Face where the file is (one HEAD request, signed in if you are), without following
///    the redirect. The raw Location header is written to the activity log (signature values hidden).
/// 2. Download from that address with a *download task* in a *background session*: iOS writes the
///    file to disk itself, keeps going when Nourish is in the background or the phone is locked,
///    and hands over "resume data" when a transfer breaks, so tapping Download again continues.
///    The Hugging Face token is never sent to the download server (its address is already signed).
/// 3. Check the file: the right number of bytes (the size Hugging Face lists) and a GGUF header.
///    Only then is it moved into the models folder.
///
/// If the background session fails before any data arrives, the same download is tried once more in
/// a normal session. Progress numbers are the bytes actually written, nothing else.
final class ModelDownloads: NSObject, URLSessionDownloadDelegate {
    static let shared = ModelDownloads()
    static let sessionID = (Bundle.main.bundleIdentifier ?? "io.github.nourish.app") + ".models"

    /// (message, level) for the activity log.
    var log: (String, String) -> Void = { _, _ in }
    /// (progress event, finished, downloads still running).
    var report: ([String: Any], Bool, Int) -> Void = { _, _, _ in }
    /// Given by iOS when it woke the app for finished background downloads.
    var backgroundEventsDone: (() -> Void)?

    private struct Job {
        let file: String
        let expected: Int64
        let source: URL?
        let token: String?
        var task: URLSessionDownloadTask?
        var foreground = false
        var fromResumeData = false
        var resumeOffset: Int64 = 0
        var sinceStart: Int64 = 0
        var serverTotal: Int64 = -1
        var startedAt = Date()
        var lastReport = Date.distantPast
        var failure: String?
        var saved = false
        var cancelled = false
        var received: Int64 { resumeOffset + sinceStart }
    }

    // Everything below runs on this one queue (the sessions' delegate queue), so no locking is needed.
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.name = "nourish.downloads"
        return q
    }()
    private var jobs: [String: Job] = [:]
    private lazy var background: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
        config.isDiscretionary = false          // start now, not when iOS finds it convenient
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    private lazy var foreground: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    private let resolver = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)   // we want to see the redirect, not follow it
        }
    }

    private static func resumeURL(_ file: String) -> URL { NativeBridge.modelsDir.appendingPathComponent(file + ".resume") }

    /// Reconnects to downloads iOS carried on while Nourish was closed (they report as they finish).
    func reconnect() {
        queue.addOperation {
            self.background.getAllTasks { tasks in
                let running = tasks.compactMap { $0.taskDescription?.components(separatedBy: "|").first }
                if !running.isEmpty { self.log("Downloads still running in the background: \(running.joined(separator: ", "))", "info") }
            }
        }
    }

    // MARK: Starting and cancelling

    func start(url: URL, file: String, expected: Int64, token: String?) {
        queue.addOperation {
            if let old = self.jobs[file]?.task { old.cancel() }   // its callbacks are ignored from now on
            self.jobs[file] = Job(file: file, expected: expected, source: url, token: token)
            // A leftover partial file from Nourish 0.4.0–0.4.2 (they downloaded differently).
            try? FileManager.default.removeItem(at: NativeBridge.modelsDir.appendingPathComponent(file + ".part"))
            if let data = try? Data(contentsOf: Self.resumeURL(file)) {
                try? FileManager.default.removeItem(at: Self.resumeURL(file))
                self.log("Download \(file): continuing the earlier, unfinished download", "info")
                self.jobs[file]?.fromResumeData = true
                self.begin(file, self.background.downloadTask(withResumeData: data))
            } else {
                self.resolveAndBegin(file)
            }
        }
    }

    func cancel(_ file: String) {
        queue.addOperation {
            guard let job = self.jobs[file] else { return }
            self.jobs[file]?.cancelled = true
            if let task = job.task {
                // Keep what was downloaded so far: Download continues from there.
                task.cancel(byProducingResumeData: { data in
                    if let data { try? data.write(to: Self.resumeURL(file)) }
                })
            } else {
                self.finish(file, "cancelled")
            }
        }
    }

    // MARK: 1. Ask Hugging Face where the file is

    private func resolveAndBegin(_ file: String) {
        guard let job = jobs[file], let source = job.source else { return }
        let token = job.token
        DispatchQueue.global(qos: .userInitiated).async {
            let result = self.resolve(source, token: token, file: file)
            self.queue.addOperation {
                guard let current = self.jobs[file], current.source == source, current.task == nil else { return }
                if current.cancelled { return self.finish(file, "cancelled") }
                switch result {
                case .failure(let failure):
                    self.jobs[file]?.failure = failure.message
                    self.finish(file, "error")
                case .success(let target):
                    var request = URLRequest(url: target)
                    // Only a Hugging Face address gets the token; signed download-server addresses never do.
                    if let token, NativeBridge.isHuggingFace(target) { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
                    let session = current.foreground ? self.foreground : self.background
                    self.log("Download \(file): downloading from \(target.host ?? "?") (\(current.foreground ? "normal" : "background") download\(request.value(forHTTPHeaderField: "Authorization") != nil ? ", signed in" : ", no token sent"))", "info")
                    self.begin(file, session.downloadTask(with: request))
                }
            }
        }
    }

    private struct Failure: Error { let message: String }

    private func resolve(_ start: URL, token: String?, file: String) -> Result<URL, Failure> {
        var url = start
        for _ in 0..<6 {
            guard NativeBridge.isHuggingFace(url) else { return .success(url) }   // a download server: fetch it directly
            var request = URLRequest(url: url, timeoutInterval: 30)
            request.httpMethod = "HEAD"
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            log("Download \(file): HEAD \(url.host ?? "?")\(url.path)\(token != nil ? " (signed in to Hugging Face)" : "")", "info")
            let (response, error) = headSync(request)
            guard let response else {
                if let error = error as NSError? { log("Download \(file): Hugging Face didn't answer: \(Self.describe(error))", "warn") }
                return .failure(Failure(message: "Couldn't reach Hugging Face (\(error?.localizedDescription ?? "no answer")). Check the internet connection and tap Download again."))
            }
            let status = response.statusCode
            log("Download \(file): Hugging Face answered HTTP \(status), file size \(response.value(forHTTPHeaderField: "X-Linked-Size") ?? "not given")", status >= 400 ? "warn" : "info")
            switch status {
            case 200..<300:
                return .success(url)
            case 300..<400:
                guard let location = response.value(forHTTPHeaderField: "Location"), !location.isEmpty else {
                    return .failure(Failure(message: "Hugging Face sent a redirect without an address (HTTP \(status))."))
                }
                log("Download \(file): Location header, \(location.count) characters (signature values hidden): \(Self.redact(location))", "info")
                guard let next = NativeBridge.redirectTarget(location, from: url) else {
                    log("Download \(file): that Location can't be used as an https address", "error")
                    return .failure(Failure(message: "Hugging Face sent a download address the app can't use. Please share the Activity log."))
                }
                if next.fixed > 0 { log("Download \(file): \(next.fixed) character(s) in it had to be percent-encoded", "warn") }
                url = next.url
            case 401, 403:
                return .failure(Failure(message: "Hugging Face refused the download (HTTP \(status)). This model may need you to sign in (Settings → AI model) and accept its licence on huggingface.co."))
            case 404:
                return .failure(Failure(message: "Hugging Face doesn't have that file (HTTP 404). Tap Refresh on the model list."))
            default:
                return .failure(Failure(message: "Hugging Face answered HTTP \(status). Try again in a minute."))
            }
        }
        return .failure(Failure(message: "Hugging Face redirected too many times."))
    }

    private func headSync(_ request: URLRequest) -> (HTTPURLResponse?, Error?) {
        let done = DispatchSemaphore(value: 0)
        var out: (HTTPURLResponse?, Error?) = (nil, nil)
        resolver.dataTask(with: request) { _, response, error in
            out = (response as? HTTPURLResponse, error)
            done.signal()
        }.resume()
        done.wait()
        return out
    }

    // MARK: 2. Download

    private func begin(_ file: String, _ task: URLSessionDownloadTask) {
        guard var job = jobs[file] else { return }
        task.taskDescription = "\(file)|\(job.expected)"
        job.task = task
        job.startedAt = Date()
        job.resumeOffset = 0
        job.sinceStart = 0
        jobs[file] = job
        task.resume()
        send(file, "running")
    }

    /// The job a task belongs to. Tasks of a replaced download are ignored; tasks iOS finished while
    /// Nourish was closed get a job made from their description ("file|size").
    private func file(for task: URLSessionTask) -> String? {
        let parts = task.taskDescription?.components(separatedBy: "|") ?? []
        guard let file = parts.first, !file.isEmpty else { return nil }
        if let job = jobs[file] { return job.task === task ? file : nil }
        var job = Job(file: file, expected: parts.count > 1 ? Int64(parts[1]) ?? -1 : -1, source: nil, token: nil)
        job.task = task as? URLSessionDownloadTask
        jobs[file] = job
        return file
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64, expectedTotalBytes: Int64) {
        guard let file = file(for: downloadTask) else { return }
        jobs[file]?.resumeOffset = fileOffset
        log("Download \(file): continuing from \(fileOffset) bytes", "info")
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let file = file(for: downloadTask), var job = jobs[file] else { return }
        if job.sinceStart == 0, let response = downloadTask.response as? HTTPURLResponse {
            log("Download \(file): server answered HTTP \(response.statusCode) from \(response.url?.host ?? "?"), sending \(response.expectedContentLength) bytes", "info")
        }
        job.sinceStart += bytesWritten
        if job.resumeOffset == 0, totalBytesExpectedToWrite > 0 { job.serverTotal = totalBytesExpectedToWrite }   // only used when Hugging Face listed no size
        let report = Date().timeIntervalSince(job.lastReport) > 0.4
        if report { job.lastReport = Date() }
        jobs[file] = job
        if report { send(file, "running") }
    }

    // MARK: 3. Check and keep the file

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // iOS deletes `location` when this returns, so everything happens right here.
        guard let file = file(for: downloadTask), let job = jobs[file] else { return }
        let response = downloadTask.response as? HTTPURLResponse
        let status = response?.statusCode ?? 0
        let size = ((try? FileManager.default.attributesOfItem(atPath: location.path))?[.size] as? NSNumber)?.int64Value ?? 0
        log("Download \(file): transfer ended, HTTP \(status) from \(response?.url?.host ?? "?"), \(size) bytes on disk", (200..<300).contains(status) ? "info" : "warn")
        guard (200..<300).contains(status) else {
            let body = (try? String(contentsOf: location, encoding: .utf8)).map { String($0.prefix(400)) } ?? ""
            if !body.isEmpty { log("Download \(file): the server said: \(body)", "warn") }
            jobs[file]?.failure = status == 403 || status == 401
                ? "The download server refused the request (HTTP \(status)). Tap Download to try again."
                : "Download failed (HTTP \(status)). Tap Download to try again."
            return
        }
        if job.expected > 0, size != job.expected {
            jobs[file]?.failure = "The download was incomplete (\(size) of \(job.expected) bytes). Tap Download to try again."
            return
        }
        guard let head = try? FileHandle(forReadingFrom: location), head.readData(ofLength: 4) == Data("GGUF".utf8) else {
            jobs[file]?.failure = "The downloaded file isn't a GGUF model."
            return
        }
        try? head.close()
        let destination = NativeBridge.modelsDir.appendingPathComponent(file)
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            jobs[file]?.failure = "Couldn't save the model: \(error.localizedDescription)"
            return
        }
        let secs = max(Date().timeIntervalSince(job.startedAt), 0.1)
        log(String(format: "Download %@: saved, %lld bytes%@, GGUF header OK, %.0f s (%.1f MB/s)", file, size,
                   job.expected > 0 ? " (exactly the size Hugging Face lists)" : "", secs, Double(job.received) / secs / 1_048_576), "info")
        jobs[file]?.saved = true
        jobs[file]?.sinceStart = size - (jobs[file]?.resumeOffset ?? 0)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let file = file(for: task), let job = jobs[file] else { return }
        if let error = error as NSError? {
            if let data = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
                try? data.write(to: Self.resumeURL(file))
                if !job.cancelled { log("Download \(file): kept the \(job.received) bytes downloaded so far; Download continues from there", "info") }
            }
            if job.cancelled { return finish(file, "cancelled") }
            log("Download \(file): stopped after \(job.received) bytes: \(Self.describe(error))", "warn")
            if job.sinceStart == 0, job.source != nil {
                if job.fromResumeData {
                    // Old resume data (e.g. its signed address expired): start again from scratch.
                    try? FileManager.default.removeItem(at: Self.resumeURL(file))
                    log("Download \(file): couldn't continue the earlier download, starting again", "info")
                    return retry(file, foreground: job.foreground)
                }
                if !job.foreground {
                    log("Download \(file): trying once more as a normal (not background) download", "info")
                    return retry(file, foreground: true)
                }
            }
            jobs[file]?.failure = job.received > 0
                ? "The connection broke after \(Self.megabytes(job.received)). Tap Download to continue from there."
                : "\(error.localizedDescription) Tap Download to try again."
            return finish(file, "error")
        }
        if job.saved { return finish(file, "done") }
        if job.failure == nil { jobs[file]?.failure = "The download ended without a file. Tap Download to try again." }
        finish(file, "error")
    }

    private func retry(_ file: String, foreground: Bool) {
        guard let job = jobs[file] else { return }
        var fresh = Job(file: file, expected: job.expected, source: job.source, token: job.token)
        fresh.foreground = foreground
        jobs[file] = fresh
        resolveAndBegin(file)
    }

    /// Only for normal-session downloads (background sessions follow redirects on their own):
    /// the request iOS proposes is passed on unchanged, except that a token never leaves Hugging Face.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let name = file(for: task) ?? "?"
        guard let next = request.url, next.scheme == "https" else {
            log("Download \(name): refused a redirect to a non-https address", "error")
            return completionHandler(nil)
        }
        log("Download \(name): HTTP \(response.statusCode), redirected to \(next.host ?? "?")", "info")
        if !NativeBridge.isHuggingFace(next), request.value(forHTTPHeaderField: "Authorization") != nil {
            var stripped = request
            stripped.setValue(nil, forHTTPHeaderField: "Authorization")
            return completionHandler(stripped)
        }
        completionHandler(request)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundEventsDone?()
            self.backgroundEventsDone = nil
        }
    }

    // MARK: Reporting

    private func send(_ file: String, _ state: String) {
        guard let job = jobs[file] else { return }
        let total = job.expected > 0 ? job.expected : job.serverTotal
        var payload: [String: Any] = ["file": file, "received": job.received, "total": total, "state": state]
        if let failure = job.failure { payload["error"] = failure }
        let finished = state != "running"
        let active = jobs.filter { $0.key != file && $0.value.task != nil }.count + (finished ? 0 : 1)
        report(payload, finished, active)
    }

    private func finish(_ file: String, _ state: String) {
        send(file, state)
        if let failure = jobs[file]?.failure, state == "error" { log("Download \(file): failed — \(failure)", "error") }
        jobs[file] = nil
    }

    private static func megabytes(_ n: Int64) -> String { "\(max(0, n) / 1_048_576) MB" }

    /// Everything an NSError says, for the activity log (addresses with signature values hidden).
    static func describe(_ error: NSError) -> String {
        var parts = ["\(error.domain) \(error.code): \(error.localizedDescription)"]
        if let failing = error.userInfo[NSURLErrorFailingURLStringErrorKey] as? String { parts.append("address: \(redact(failing))") }
        if let stream = error.userInfo["_kCFStreamErrorCodeKey"] { parts.append("stream error \(stream)") }
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("underlying: \(underlying.domain) \(underlying.code) \(underlying.localizedDescription)")
        }
        return parts.joined(separator: "; ")
    }

    /// An address exactly as received, except the values of its signature parts.
    static func redact(_ address: String) -> String {
        guard let q = address.firstIndex(of: "?") else { return address }
        let secret: Set<String> = ["signature", "policy", "key-pair-id", "x-amz-signature", "x-amz-credential",
                                   "x-amz-security-token", "user_id", "x-xet-cas-uid"]
        let query = address[address.index(after: q)...].split(separator: "&", omittingEmptySubsequences: false).map { part -> String in
            let kv = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2, secret.contains(kv[0].lowercased()) else { return String(part) }
            return "\(kv[0])=[\(kv[1].count) characters hidden]"
        }
        return String(address[..<q]) + "?" + query.joined(separator: "&")
    }
}
