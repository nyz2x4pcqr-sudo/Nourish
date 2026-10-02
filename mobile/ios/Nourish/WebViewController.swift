import UIKit
import WebKit

/// Nourish for iPhone. By default it runs entirely on the phone: the built-in copy of Nourish
/// (served from the app at nourish://app/) with on-device AI. In Settings you can instead connect
/// to Nourish on your PC; the app then shows the PC's copy (the "connect" page finds it).
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    // Both are also settable as launch arguments (used by the automated build test):
    // -server_url <url>, -mode local|server, -js_probe <async JavaScript>.
    private static let serverKey = "server_url"
    private static let modeKey = "mode"
    private var webView: WKWebView!
    private let bridge = NativeBridge()
    private var serverURL: URL? {
        get { UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:)) }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: Self.serverKey) }
    }
    private var mode: String {
        get { UserDefaults.standard.string(forKey: Self.modeKey) ?? "local" }
        set { UserDefaults.standard.set(newValue, forKey: Self.modeKey) }
    }
    private var connectError: String?
    private var probeDone = false
    private let background = UIColor(red: 0x0C / 255, green: 0x0B / 255, blue: 0x0A / 255, alpha: 1)
    private let lightBackground = UIColor(red: 0xF5 / 255, green: 0xEF / 255, blue: 0xE6 / 255, alpha: 1)
    private var lightTheme = false

    // Dark text on the light theme, white text on the dark one (the page tells us which, see below).
    override var preferredStatusBarStyle: UIStatusBarStyle { lightTheme ? .darkContent : .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = background

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()   // keeps your plan and settings (localStorage)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        config.applicationNameForUserAgent = "NourishApp/\(version) (iOS)"
        config.setURLSchemeHandler(LocalAppSchemeHandler(), forURLScheme: LocalAppSchemeHandler.scheme)
        config.userContentController.add(self, name: "nourishTheme")    // the page reports "light" or "dark"
        config.userContentController.add(self, name: "nourishNative")   // on-device AI, downloads, … (NativeBridge)
        config.userContentController.add(self, name: "nourishHaptic")   // a light tap under the finger (app.js haptic())

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

        bridge.send = { [weak self] js in self?.webView.evaluateJavaScript(js) }
        bridge.setMode = { [weak self] mode in self?.switchMode(mode) }
        loadForMode()
    }

    private func loadForMode() {
        if mode == "server" {
            if let url = serverURL { webView.load(URLRequest(url: url)) } else { showConnect(error: nil) }
        } else {
            webView.load(URLRequest(url: LocalAppSchemeHandler.startURL))
        }
    }

    private func switchMode(_ newMode: String) {
        if newMode == "server" {
            mode = "server"
            showConnect(error: nil)   // pick (or confirm) the PC
        } else {
            mode = "local"
            webView.load(URLRequest(url: LocalAppSchemeHandler.startURL))
        }
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
                mode = "server"
                webView.load(URLRequest(url: target))
            } else if url.host == "connect" {
                showConnect(error: nil)
            } else if url.host == "local" {
                switchMode("local")
            }
            return
        }
        if url.isFileURL || url.scheme == LocalAppSchemeHandler.scheme || isServer(url) || url.scheme == "about" || url.scheme == "blob" {
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
        if webView.url?.isFileURL == true || webView.url?.scheme == LocalAppSchemeHandler.scheme { return }
        let address = serverURL?.absoluteString ?? "your PC"
        showConnect(error: "Couldn't reach Nourish at \(address). Is it running on your PC, and is this iPhone on the same Wi-Fi?")
    }

    // The page also gets the screen's safe areas from here (as --native-safe-*), in case
    // env(safe-area-inset-*) reports 0, as it can when the app runs inside another app.
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        sendSafeArea()
    }

    private func sendSafeArea() {
        guard let webView else { return }
        let i = view.safeAreaInsets
        let js = "(function (s) { s.setProperty('--native-safe-top', '\(Int(i.top))px'); s.setProperty('--native-safe-bottom', '\(Int(i.bottom))px'); "
            + "s.setProperty('--native-safe-left', '\(Int(i.left))px'); s.setProperty('--native-safe-right', '\(Int(i.right))px'); })(document.documentElement.style)"
        webView.evaluateJavaScript(js)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        sendSafeArea()
        if webView.url?.scheme == LocalAppSchemeHandler.scheme { runProbeIfAsked() }
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

    /// Automated build test: runs the given JavaScript in the built-in app (it may wait on
    /// promises, e.g. an on-device AI request) and saves its result to Documents/probe.json.
    private func runProbeIfAsked() {
        guard !probeDone, let probe = UserDefaults.standard.string(forKey: "js_probe") else { return }
        probeDone = true
        webView.callAsyncJavaScript(probe, arguments: [:], in: nil, in: .page) { result in
            var out: [String: Any] = [:]
            switch result {
            case .success(let value): out["ok"] = true; out["value"] = value
            case .failure(let error): out["ok"] = false; out["error"] = "\(error)"
            }
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try? NativeBridge.json(out).data(using: .utf8)?.write(to: docs.appendingPathComponent("probe.json"))
        }
    }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "nourishNative" {
            guard let body = message.body as? [String: Any], let id = body["id"] as? String, let cmd = body["cmd"] as? String else { return }
            bridge.handle(id: id, cmd: cmd, args: body["args"] as? [String: Any] ?? [:])
            return
        }
        if message.name == "nourishHaptic" {
            playHaptic(message.body as? String ?? "")
            return
        }
        guard message.name == "nourishTheme", let theme = message.body as? String else { return }
        lightTheme = theme == "light"
        let color = lightTheme ? lightBackground : background
        view.backgroundColor = color
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        setNeedsStatusBarAppearanceUpdate()
    }

    private func playHaptic(_ style: String) {
        switch style {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "select": UISelectionFeedbackGenerator().selectionChanged()
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
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
