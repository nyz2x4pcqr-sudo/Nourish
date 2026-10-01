import Foundation
import WebKit

/// Serves the built-in copy of Nourish (the "webapp" folder in the app) at nourish://app/…,
/// so it runs with no PC and gets its own web storage.
final class LocalAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "nourish"
    static let startURL = URL(string: "nourish://app/index.html")!
    private let root = Bundle.main.url(forResource: "webapp", withExtension: nil)?.standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app", let root else { return notFound(task) }
        var path = url.path
        while path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else { return notFound(task) }
        let headers = ["Content-Type": Self.mimeType(path), "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else { return notFound(task) }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func notFound(_ task: WKURLSchemeTask) {
        task.didFailWithError(URLError(.fileDoesNotExist))
    }

    private static func mimeType(_ path: String) -> String {
        if path.hasSuffix(".html") { return "text/html; charset=utf-8" }
        if path.hasSuffix(".js") { return "text/javascript; charset=utf-8" }
        if path.hasSuffix(".css") { return "text/css; charset=utf-8" }
        if path.hasSuffix(".png") { return "image/png" }
        if path.hasSuffix(".webmanifest") { return "application/manifest+json" }
        return "application/octet-stream"
    }
}
