import UIKit
import WebKit

/// Nourish for iPhone: a full-screen web view of the Nourish app running on your PC.
/// The first time (or when the PC can't be reached) it shows a "connect" page that can find
/// the PC on your Wi-Fi. The address is remembered.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private static let serverKey = "server_url"   // also settable as a launch argument: -server_url <url>
    private var webView: WKWebView!
    private var serverURL: URL? {
        get { UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:)) }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: Self.serverKey) }
    }
    private var connectError: String?
    private let background = UIColor(red: 0x14 / 255, green: 0x11 / 255, blue: 0x0F / 255, alpha: 1)

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = background

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()   // keeps your plan and settings (localStorage)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        config.applicationNameForUserAgent = "NourishApp/\(version) (iOS)"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page handles safe areas itself
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        if let url = serverURL { webView.load(URLRequest(url: url)) } else { showConnect(error: nil) }
    }

    private func showConnect(error: String?) {
        connectError = error
        guard let page = Bundle.main.url(forResource: "connect", withExtension: "html") else { return }
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    private func isServer(_ url: URL) -> Bool {
        guard let server = serverURL else { return false }
        return url.host == server.host && url.port == server.port
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "nourishapp" {
            decisionHandler(.cancel)
            if url.host == "open",
               let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
               let target = URL(string: value), ["http", "https"].contains(target.scheme ?? "") {
                serverURL = target
                webView.load(URLRequest(url: target))
            } else if url.host == "connect" {
                showConnect(error: nil)
            }
            return
        }
        if url.isFileURL || isServer(url) || url.scheme == "about" || url.scheme == "blob" {
            return decisionHandler(.allow)
        }
        // Anything else (e.g. a recipe's original website) opens in Safari.
        decisionHandler(.cancel)
        UIApplication.shared.open(url)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    private func handleLoadFailure(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        if webView.url?.isFileURL == true { return }
        let address = serverURL?.absoluteString ?? "your PC"
        showConnect(error: "Couldn't reach Nourish at \(address). Is it running on your PC, and is this iPhone on the same Wi-Fi?")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.isFileURL == true else { return }
        let info: [String: Any] = [
            "last": serverURL?.absoluteString ?? NSNull(),
            "error": connectError ?? NSNull(),
            "ip": Self.localIPv4() ?? NSNull(),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: info), let json = String(data: data, encoding: .utf8) {
            webView.evaluateJavaScript("window.nourishInit(\(json))")
        }
    }

    // MARK: Dialogs and new windows

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // MARK: Helpers

    /// This device's Wi-Fi address, so the connect page can scan the same network for the PC.
    private static func localIPv4() -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        var fallback: String?
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let iface = ptr.pointee
            guard let addr = iface.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            let ip = String(cString: host)
            let name = String(cString: iface.ifa_name)
            if name == "en0" { return ip }                       // Wi-Fi
            if fallback == nil, !ip.hasPrefix("127."), !ip.hasPrefix("169.254.") { fallback = ip }
        }
        return fallback
    }
}
