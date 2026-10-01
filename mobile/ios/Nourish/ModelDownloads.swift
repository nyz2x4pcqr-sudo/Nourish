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
/// Since 0.4.3 the normal (foreground) session is used: on a real iPhone (0.4.2) the background session
/// accepted the task and then never started it, with no callback at all. A watchdog stops any download
/// that hasn't received a byte after 30 seconds and says so. Progress numbers are the bytes actually
/// written, nothing else.
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
        let id = UUID()                // tells a replaced download's late answers apart
        let file: String
        let expected: Int64
        let source: URL?
        let token: String?
        var task: URLSessionDownloadTask?
        var foreground = false
        var resumeData: Data?          // what this attempt continues from, if anything
        var resumeOffset: Int64 = 0
        var sinceStart: Int64 = 0
        var serverTotal: Int64 = -1
        var startedAt = Date()
        var lastReport = Date.distantPast
        var failure: String?
        var saved = false
        var cancelled = false
        var stalled: String?           // set by the watchdog when no data arrived in time
        var logged5: Int64 = -1        // last 5% step written to the log
        var target: URL?               // the download server address Hugging Face gave
        var checked = false            // the download check already ran for this download
        var checking = false           // ... and is running now
        var chunked = false            // downloading in 16 MB pieces (see "Step-by-step download")
        var chunkTask: URLSessionDataTask?
        var advice: String?            // from the download check, added to a final error
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
    /// Set when a background download fails before any data arrives (seen in the iOS simulator:
    /// NSURLErrorDomain -1 straight away). Remembered per app version; then normal downloads are used.
    private static let backgroundBrokenKey = "downloads_background_broken"
    private static var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?" }
    private var backgroundBroken: Bool {
        get { UserDefaults.standard.string(forKey: Self.backgroundBrokenKey) == Self.appVersion }
        set { UserDefaults.standard.set(newValue ? Self.appVersion : nil, forKey: Self.backgroundBrokenKey) }
    }
    private lazy var background: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
        config.isDiscretionary = false          // start now, not when iOS finds it convenient
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        config.timeoutIntervalForResource = 6 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    private lazy var foreground: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60              // longest wait for the next piece of data
        config.timeoutIntervalForResource = 7200           // a whole model on a slow connection
        config.waitsForConnectivity = false                // fail with iOS's real error instead of waiting silently
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true       // Low Data Mode
        self.log("Download session: waitsForConnectivity \(config.waitsForConnectivity), allowsCellularAccess \(config.allowsCellularAccess), allowsExpensiveNetworkAccess \(config.allowsExpensiveNetworkAccess), allowsConstrainedNetworkAccess \(config.allowsConstrainedNetworkAccess), request timeout \(Int(config.timeoutIntervalForRequest)) s, resource timeout \(Int(config.timeoutIntervalForResource)) s", "info")
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    /// The step-by-step download uses the same kind of short requests as the app's Hugging Face calls.
    private let chunkSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 600
        config.waitsForConnectivity = false
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: config)
    }()
    private let resolver = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)   // we want to see the redirect, not follow it
        }
    }

    private static func resumeURL(_ file: String) -> URL { NativeBridge.modelsDir.appendingPathComponent(file + ".resume") }

    /// Background downloads are no longer started (see the top). Any left over from 0.4.2, which may be
    /// stuck in iOS's queue without ever starting, are listed in the log and cancelled.
    func reconnect() {
        queue.addOperation {
            self.background.getAllTasks { tasks in
                for task in tasks {
                    self.log("Cancelling a background download left over from an older Nourish: \(task.taskDescription ?? "?"), state \(Self.stateName(task.state)), \(task.countOfBytesReceived) bytes received", "info")
                    task.cancel()
                }
            }
        }
    }

    private static let useBackground = false

    static func stateName(_ state: URLSessionTask.State) -> String {
        switch state {
        case .running: return "running"
        case .suspended: return "suspended"
        case .canceling: return "cancelling"
        case .completed: return "completed"
        @unknown default: return "unknown"
        }
    }

    // MARK: Starting and cancelling

    /// `chunked` starts straight with the step-by-step download (the automated test uses it).
    func start(url: URL, file: String, expected: Int64, token: String?, chunked: Bool = false) {
        queue.addOperation {
            if let old = self.jobs[file]?.task { old.cancel() }   // its callbacks are ignored from now on
            self.jobs[file]?.chunkTask?.cancel()
            self.jobs[file] = Job(file: file, expected: expected, source: url, token: token)
            self.jobs[file]?.foreground = !Self.useBackground || self.backgroundBroken
            // A partial file (from a step-by-step download, or from Nourish 0.4.0–0.4.2, which saved the
            // same bytes the same way) is continued step by step.
            let partSize = (try? FileManager.default.attributesOfItem(atPath: Self.partURL(file).path)[.size] as? NSNumber)?.int64Value ?? 0
            if chunked || partSize > 0 {
                return self.startChunked(file, reason: chunked ? "asked for" : "continuing \(partSize) bytes already on the phone")
            }
            if let data = try? Data(contentsOf: Self.resumeURL(file)) {
                try? FileManager.default.removeItem(at: Self.resumeURL(file))
                self.log("Download \(file): continuing the earlier, unfinished download", "info")
                self.jobs[file]?.resumeData = data
                let session = (self.jobs[file]?.foreground ?? false) ? self.foreground : self.background
                self.begin(file, session.downloadTask(withResumeData: data))
            } else {
                self.resolveAndBegin(file)
            }
        }
    }

    func cancel(_ file: String) {
        queue.addOperation {
            guard let job = self.jobs[file] else { return }
            self.jobs[file]?.cancelled = true
            if job.chunked {
                job.chunkTask?.cancel()          // the piece's completion sees `cancelled`
                if job.chunkTask == nil { self.finish(file, "cancelled") }
            } else if job.checking {
                self.finish(file, "cancelled")
            } else if let task = job.task {
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
                    self.jobs[file]?.target = target
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
        log("Download \(file): task \(task.taskIdentifier) resumed, state \(Self.stateName(task.state))", "info")
        send(file, "running")
        for seconds in [2.0, 10.0, 30.0] {
            DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { [weak self, weak task] in
                guard let self, let task else { return }
                self.queue.addOperation { self.check(file, task, after: seconds) }
            }
        }
    }

    /// The 2 s and 10 s checks only report; at 30 s with no data the download is stopped (the watchdog).
    private func check(_ file: String, _ task: URLSessionDownloadTask, after seconds: Double) {
        guard let job = jobs[file], job.task === task, !job.saved else { return }
        log(String(format: "Download %@: after %.0f s: state %@, %lld bytes received, %.1f%% done", file, seconds,
                   Self.stateName(task.state), task.countOfBytesReceived, task.progress.fractionCompleted * 100), "info")
        guard seconds >= 30, job.received == 0, task.countOfBytesReceived == 0, task.state != .completed else { return }
        log("Download \(file): no data in 30 s, stopping it", "warn")
        jobs[file]?.stalled = "The download didn't start (no data from the download server in 30 seconds). Check the internet connection and tap Download to try again."
        task.cancel()
    }

    func urlSession(_ session: URLSession, taskIsWaitingForConnectivity task: URLSessionTask) {
        log("Download \(task.taskDescription ?? "?"): waiting for an internet connection", "warn")
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
        guard let file = file(for: downloadTask), var job = jobs[file] else {
            log("Download \(downloadTask.taskDescription ?? "?"): data for a download that was replaced or stopped (\(totalBytesWritten) bytes)", "debug")
            return
        }
        if job.sinceStart == 0, let response = downloadTask.response as? HTTPURLResponse {
            log("Download \(file): server answered HTTP \(response.statusCode) from \(response.url?.host ?? "?"), sending \(response.expectedContentLength) bytes", "info")
        }
        job.sinceStart += bytesWritten
        let total = job.expected > 0 ? job.expected : totalBytesExpectedToWrite
        let step = total > 0 ? job.received * 20 / total : -1   // 5% steps
        if job.logged5 < 0 || step > job.logged5 {
            job.logged5 = max(step, 0)
            log("Download \(file): \(job.received) of \(total > 0 ? String(total) : "?") bytes (\(total > 0 ? String(job.received * 100 / total) : "?")%)", "info")
        }
        if job.resumeOffset == 0, totalBytesExpectedToWrite > 0 { job.serverTotal = totalBytesExpectedToWrite }   // only used when Hugging Face listed no size
        let report = Date().timeIntervalSince(job.lastReport) > 0.4
        if report { job.lastReport = Date() }
        jobs[file] = job
        if report { send(file, "running") }
    }

    // MARK: 3. Check and keep the file

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // iOS deletes `location` when this returns, so everything happens right here.
        log("Download \(downloadTask.taskDescription ?? "?"): iOS finished the transfer (task \(downloadTask.taskIdentifier))", "info")
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
        let offset = jobs[file]?.resumeOffset ?? 0
        jobs[file]?.saved = true
        jobs[file]?.sinceStart = size - offset
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        log("Download \(task.taskDescription ?? "?"): task \(task.taskIdentifier) ended \(error == nil ? "without an error" : "with: " + Self.describe(error! as NSError)), \(task.countOfBytesReceived) bytes received", error == nil ? "info" : "warn")
        guard let file = file(for: task), let job = jobs[file] else { return }
        if job.stalled != nil || (error != nil && job.sinceStart == 0 && !job.cancelled && job.resumeData == nil && session !== background) {
            // No data at all: find out why (logged), then try the step-by-step download.
            if job.source != nil, !job.checked { return checkThenChunked(file, failure: job.stalled ?? "") }
            if let stalled = job.stalled {
                jobs[file]?.failure = stalled
                return finish(file, "error")
            }
        }
        if let error = error as NSError? {
            if let data = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
                try? data.write(to: Self.resumeURL(file))
                if !job.cancelled { log("Download \(file): kept the \(job.received) bytes downloaded so far; Download continues from there", "info") }
            }
            if job.cancelled { return finish(file, "cancelled") }
            log("Download \(file): stopped after \(job.received) bytes: \(Self.describe(error))", "warn")
            if job.sinceStart == 0, job.source != nil {
                if session === background {
                    if error.code != NSURLErrorNotConnectedToInternet { backgroundBroken = true }
                    log("Download \(file): trying once more as a normal (not background) download", "info")
                    return retry(file, foreground: true, resumeData: job.resumeData)
                }
                if job.resumeData != nil {
                    // The earlier download can't be continued (e.g. its signed address expired): start over.
                    log("Download \(file): couldn't continue the earlier download, starting again", "info")
                    return retry(file, foreground: true, resumeData: nil)
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

    // MARK: Download check, then step-by-step download

    private func checkThenChunked(_ file: String, failure: String) {
        guard let job = jobs[file], let source = job.source else { return }
        jobs[file]?.checked = true
        jobs[file]?.checking = true
        jobs[file]?.task = nil
        log("Download \(file): no data arrived, so checking the connection, then trying a step-by-step download", "warn")
        DispatchQueue.global(qos: .userInitiated).async {
            let outcome = DownloadCheck.run(source: source, target: job.target, token: job.token, label: file, log: self.log)
            self.queue.addOperation {
                guard let current = self.jobs[file], current.checking else { return }
                self.jobs[file]?.checking = false
                if current.cancelled { return self.finish(file, "cancelled") }
                self.jobs[file]?.advice = outcome.advice
                self.startChunked(file, reason: "the normal download got no data", target: outcome.alternate ?? job.target)
            }
        }
    }

    // MARK: Step-by-step download
    //
    // 16 MB pieces, each its own short request with "Range: bytes=start-end", appended to <file>.part.
    // The .part file's size is the progress, so a failed piece is retried and a later Download continues
    // from there. At most one piece (16 MB) is in memory at a time.

    private static let chunkSize: Int64 = 16 * 1_048_576
    private static func partURL(_ file: String) -> URL { NativeBridge.modelsDir.appendingPathComponent(file + ".part") }

    private func startChunked(_ file: String, reason: String, target: URL? = nil) {
        guard var job = jobs[file] else { return }
        job.chunked = true
        job.task = nil
        if let target { job.target = target }
        let part = Self.partURL(file)
        if !FileManager.default.fileExists(atPath: part.path) { FileManager.default.createFile(atPath: part.path, contents: nil) }
        job.resumeOffset = (try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? NSNumber)?.int64Value ?? 0
        job.sinceStart = 0
        job.startedAt = Date()
        jobs[file] = job
        log("Download \(file): step-by-step download in 16 MB pieces (\(reason)), from byte \(job.resumeOffset)", "info")
        send(file, "running")
        nextChunk(file, attempt: 0)
    }

    private func nextChunk(_ file: String, attempt: Int) {
        guard let job = jobs[file], job.chunked else { return }
        if job.cancelled { return finish(file, "cancelled") }
        let id = job.id
        let total = job.expected > 0 ? job.expected : job.serverTotal
        if total > 0, job.received >= total { return finishChunked(file) }
        guard let target = job.target else {
            // No download address yet (or it expired): ask Hugging Face again.
            guard let source = job.source else {
                jobs[file]?.failure = "Tap Download to continue this download."
                return finish(file, "error")
            }
            DispatchQueue.global(qos: .userInitiated).async {
                let result = self.resolve(source, token: job.token, file: file)
                self.queue.addOperation {
                    guard self.jobs[file]?.id == id else { return }
                    switch result {
                    case .success(let url):
                        self.jobs[file]?.target = url
                        self.nextChunk(file, attempt: attempt)
                    case .failure(let failure):
                        self.jobs[file]?.failure = failure.message
                        self.finish(file, "error")
                    }
                }
            }
            return
        }
        let start = job.received
        let end = total > 0 ? min(start + Self.chunkSize, total) - 1 : start + Self.chunkSize - 1
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
        if let token = job.token, NativeBridge.isHuggingFace(target) { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let began = Date()
        let task = chunkSession.dataTask(with: request) { data, response, error in
            self.queue.addOperation { self.chunkDone(file, id: id, start: start, end: end, attempt: attempt, began: began, data, response as? HTTPURLResponse, error) }
        }
        jobs[file]?.chunkTask = task
        task.resume()
    }

    private func chunkDone(_ file: String, id: UUID, start: Int64, end: Int64, attempt: Int, began: Date, _ data: Data?, _ response: HTTPURLResponse?, _ error: Error?) {
        guard let job = jobs[file], job.id == id, job.chunked, job.received == start else { return }
        jobs[file]?.chunkTask = nil
        if job.cancelled { return finish(file, "cancelled") }
        let status = response?.statusCode ?? 0
        let secs = max(Date().timeIntervalSince(began), 0.001)
        if status == 206, let data, !data.isEmpty, (response?.value(forHTTPHeaderField: "Content-Range") ?? "").hasPrefix("bytes \(start)-") {
            if start == job.resumeOffset, job.sinceStart == 0 {
                log("Download \(file): first piece OK (HTTP 206, Accept-Ranges: \(response?.value(forHTTPHeaderField: "Accept-Ranges") ?? "not sent"), Content-Range: \(response?.value(forHTTPHeaderField: "Content-Range") ?? "?"))", "info")
            }
            if let range = response?.value(forHTTPHeaderField: "Content-Range"), let slash = range.lastIndex(of: "/"), let size = Int64(range[range.index(after: slash)...]) {
                jobs[file]?.serverTotal = size
            }
            do {
                let handle = try FileHandle(forWritingTo: Self.partURL(file))
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } catch {
                jobs[file]?.failure = "Couldn't save the download: \(error.localizedDescription). Is the phone's storage full?"
                return finish(file, "error")
            }
            jobs[file]?.sinceStart += Int64(data.count)
            let now = jobs[file]!
            let total = now.expected > 0 ? now.expected : now.serverTotal
            log(String(format: "Download %@: piece %lld–%lld saved (%.1f MB/s), %lld of %lld bytes (%lld%%)", file, start, start + Int64(data.count) - 1,
                       Double(data.count) / secs / 1_048_576, now.received, total, total > 0 ? now.received * 100 / total : 0), "info")
            send(file, "running")
            return nextChunk(file, attempt: 0)
        }
        // Something went wrong with this piece.
        var detail = response.map { "HTTP \($0.statusCode)" } ?? "no answer"
        if let error { detail += ", " + Self.describe(error as NSError) }
        if status == 200 { detail += " (the server sent the whole file instead of a piece)" }
        log("Download \(file): piece \(start)–\(end) failed (attempt \(attempt + 1) of 5): \(detail)", "warn")
        if status == 200 {
            jobs[file]?.failure = "The download server doesn't support downloading in pieces."
            return finish(file, "error")
        }
        if [401, 403, 410].contains(status) { jobs[file]?.target = nil }   // the signed address expired: get a new one
        guard attempt < 4 else {
            let advice = job.advice.map { " " + $0 } ?? ""
            jobs[file]?.failure = job.received > 0
                ? "The download stopped at \(Self.megabytes(job.received)) (\(detail)). Tap Download to continue from there.\(advice)"
                : "The download couldn't start (\(detail)).\(advice)"
            return finish(file, "error")
        }
        let wait = pow(2.0, Double(attempt + 1))   // 2, 4, 8, 16 s
        DispatchQueue.global().asyncAfter(deadline: .now() + wait) {
            self.queue.addOperation { if self.jobs[file]?.id == id { self.nextChunk(file, attempt: attempt + 1) } }
        }
    }

    private func finishChunked(_ file: String) {
        guard let job = jobs[file] else { return }
        let part = Self.partURL(file)
        let size = (try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? NSNumber)?.int64Value ?? 0
        if job.expected > 0, size != job.expected {
            try? FileManager.default.removeItem(at: part)
            jobs[file]?.failure = "The download came out the wrong size (\(size) of \(job.expected) bytes), so it was deleted. Tap Download to try again."
            return finish(file, "error")
        }
        guard let head = try? FileHandle(forReadingFrom: part), head.readData(ofLength: 4) == Data("GGUF".utf8) else {
            try? FileManager.default.removeItem(at: part)
            jobs[file]?.failure = "The downloaded file isn't a GGUF model."
            return finish(file, "error")
        }
        try? head.close()
        let destination = NativeBridge.modelsDir.appendingPathComponent(file)
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.moveItem(at: part, to: destination)
        } catch {
            jobs[file]?.failure = "Couldn't save the model: \(error.localizedDescription)"
            return finish(file, "error")
        }
        let secs = max(Date().timeIntervalSince(job.startedAt), 0.1)
        log(String(format: "Download %@: saved, %lld bytes%@, GGUF header OK, %.0f s (%.1f MB/s, step by step)", file, size,
                   job.expected > 0 ? " (exactly the size Hugging Face lists)" : "", secs, Double(job.sinceStart) / secs / 1_048_576), "info")
        jobs[file]?.saved = true
        finish(file, "done")
    }

    private func retry(_ file: String, foreground: Bool, resumeData: Data?) {
        guard let job = jobs[file] else { return }
        var fresh = Job(file: file, expected: job.expected, source: job.source, token: job.token)
        fresh.foreground = foreground
        fresh.resumeData = resumeData
        jobs[file] = fresh
        if let resumeData {
            begin(file, (foreground ? self.foreground : background).downloadTask(withResumeData: resumeData))
        } else {
            resolveAndBegin(file)
        }
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
        log("Background download events delivered", "info")
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
        // Everything else iOS put in userInfo (resume data is binary, addresses are redacted above).
        let shown: Set<String> = [NSURLErrorFailingURLStringErrorKey, NSURLErrorFailingURLErrorKey, "_kCFStreamErrorCodeKey",
                                  NSUnderlyingErrorKey, NSLocalizedDescriptionKey, NSURLSessionDownloadTaskResumeData]
        let rest = error.userInfo.filter { !shown.contains($0.key) }.map { "\($0.key)=\(String(describing: $0.value).prefix(200))" }.sorted()
        if !rest.isEmpty { parts.append("userInfo: " + rest.joined(separator: ", ")) }
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
