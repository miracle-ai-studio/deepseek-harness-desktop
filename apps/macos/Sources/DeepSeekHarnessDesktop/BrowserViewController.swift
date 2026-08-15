import AppKit
@preconcurrency import WebKit
import DeepSeekHarnessDesktopCore

private final class FindSearchField: NSSearchField {
    var onCancel: (() -> Void)?

    override func cancelOperation(_ sender: Any?) {
        onCancel?()
    }
}

private struct ApprovedDownload {
    let sourceURL: URL
    var destination: SessionExportDestination?
}

/// Hosts the Harness Web client while enforcing the attached loopback origin.
final class BrowserViewController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private static let minimumPageZoom = 0.5
    private static let maximumPageZoom = 3.0
    private static let pageZoomStep = 0.1

    private let origin: LoopbackOrigin
    private let webView: WKWebView
    private let onFailure: (String) -> Void
    private let findBar = NSVisualEffectView()
    private let findField = FindSearchField()
    private let findResult = NSTextField(labelWithString: "")
    private var recoveryBudget = WebContentRecoveryBudget()
    private var approvedDownloads: [ObjectIdentifier: ApprovedDownload] = [:]
    private var activeDownloads: [ObjectIdentifier: WKDownload] = [:]
    private var cancelledDownloads: Set<ObjectIdentifier> = []
    private var reportedDownloadFailures: Set<ObjectIdentifier> = []

    init(origin: LoopbackOrigin, onFailure: @escaping (String) -> Void) {
        self.origin = origin
        self.onFailure = onFailure
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    deinit {
        cancelActiveDownloads()
    }

    override func viewDidDisappear() {
        super.viewDidDisappear()
        cancelActiveDownloads()
    }

    private func cancelActiveDownloads() {
        let downloads = activeDownloads
        let destinations = approvedDownloads.mapValues(\.destination)
        activeDownloads.removeAll()
        approvedDownloads.removeAll()
        for (identifier, download) in downloads {
            download.delegate = nil
            let destination = destinations[identifier] ?? nil
            download.cancel { _ in destination?.discard() }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func loadView() {
        let root = NSView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)
        configureFindBar(in: root)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        attach()
    }

    /// Reloads the validated Host origin rather than an untrusted redirect target.
    @objc func reloadPage(_ sender: Any?) {
        attach()
    }

    /// Restores the default WebKit page scale.
    @objc func actualSize(_ sender: Any?) {
        webView.pageZoom = 1
    }

    /// Increases WebKit page scale within the product limit.
    @objc func zoomIn(_ sender: Any?) {
        webView.pageZoom = min(Self.maximumPageZoom, webView.pageZoom + Self.pageZoomStep)
    }

    /// Decreases WebKit page scale within the product limit.
    @objc func zoomOut(_ sender: Any?) {
        webView.pageZoom = max(Self.minimumPageZoom, webView.pageZoom - Self.pageZoomStep)
    }

    /// Opens the native find strip without querying product DOM nodes.
    @objc func showFind(_ sender: Any?) {
        findBar.isHidden = false
        view.window?.makeFirstResponder(findField)
        findField.selectText(nil)
    }

    /// Finds the next occurrence of the native search query.
    @objc func findNext(_ sender: Any?) {
        performFind(backwards: false)
    }

    /// Finds the previous occurrence of the native search query.
    @objc func findPrevious(_ sender: Any?) {
        performFind(backwards: true)
    }

    /// Moves keyboard focus into WebKit after replacing the native status page.
    func focusWebContent() {
        view.window?.makeFirstResponder(webView)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            if BrowserSecurityPolicy.allowsSessionExport(url: url, origin: origin) {
                decisionHandler(.download)
            } else {
                presentDownloadFailure("Blocked a download outside the session export endpoint.")
                decisionHandler(.cancel)
            }
            return
        }

        let isTopLevel = navigationAction.targetFrame?.isMainFrame != false
        guard isTopLevel else {
            decisionHandler(BrowserSecurityPolicy.allowsSubframe(url: url, origin: origin) ? .allow : .cancel)
            return
        }
        if origin.contains(url) {
            if navigationAction.targetFrame == nil {
                webView.load(URLRequest(url: url))
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
            return
        }
        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard let url = navigationResponse.response.url else {
            decisionHandler(.cancel)
            return
        }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")
        let markedForDownload = BrowserSecurityPolicy.isAttachmentDisposition(disposition)
            || !navigationResponse.canShowMIMEType
        guard markedForDownload else {
            decisionHandler(.allow)
            return
        }
        if BrowserSecurityPolicy.allowsSessionExport(url: url, origin: origin),
           BrowserSecurityPolicy.isAttachmentDisposition(disposition) {
            decisionHandler(.download)
        } else {
            presentDownloadFailure("Blocked an unapproved download response.")
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        register(download: download, sourceURL: navigationAction.request.url)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        register(download: download, sourceURL: navigationResponse.response.url)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if origin.contains(url) {
            webView.load(URLRequest(url: url))
        } else if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard BrowserSecurityPolicy.allowsFileSelection(
            scheme: frame.securityOrigin.protocol,
            host: frame.securityOrigin.host,
            port: frame.securityOrigin.port,
            origin: origin
        )
        else {
            completionHandler(nil)
            return
        }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.canCreateDirectories = false
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
        if let window = view.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            panel.begin(completionHandler: finish)
        }
    }

    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }

    func webView(
        _ webView: WKWebView,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !isCancellation(error) else { return }
        onFailure("Unable to connect to \(origin.url.absoluteString): \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !isCancellation(error) else { return }
        onFailure("The Harness page failed to load: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if recoveryBudget.claimAutomaticReload() {
            attach()
        } else {
            onFailure("The web content process stopped repeatedly. Retry to reconnect to the Harness Host.")
        }
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let identifier = ObjectIdentifier(download)
        guard var approved = approvedDownloads[identifier] else {
            reportedDownloadFailures.insert(identifier)
            completionHandler(nil)
            presentDownloadFailure("Blocked a download without an approved session export source.")
            return
        }
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else {
                completionHandler(nil)
                return
            }
            if response == .OK, let url = panel.url {
                let destination = SessionExportDestination(finalURL: url)
                approved.destination = destination
                self.approvedDownloads[identifier] = approved
                completionHandler(destination.stagingURL)
            } else {
                self.cancelledDownloads.insert(identifier)
                completionHandler(nil)
            }
        }
        if let window = view.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            panel.begin(completionHandler: finish)
        }
    }

    func download(
        _ download: WKDownload,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void
    ) {
        reportDownloadFailureOnce(download, message: "Blocked a redirected session export download.")
        decisionHandler(.cancel)
    }

    func download(
        _ download: WKDownload,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        reportDownloadFailureOnce(download, message: "Blocked an authenticated session export download.")
        completionHandler(.cancelAuthenticationChallenge, nil)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let identifier = ObjectIdentifier(download)
        guard let approved = approvedDownloads[identifier],
              let destination = approved.destination
        else {
            reportDownloadFailureOnce(download, message: "Session export finished without an approved destination.")
            clearDownload(download)
            return
        }
        do {
            try destination.commit()
        } catch {
            destination.discard()
            presentDownloadFailure("Could not save the session export: \(error.localizedDescription)")
        }
        clearDownload(download)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let identifier = ObjectIdentifier(download)
        defer { clearDownload(download) }
        guard !cancelledDownloads.contains(identifier), !reportedDownloadFailures.contains(identifier) else { return }
        presentDownloadFailure("Session export failed: \(error.localizedDescription)")
    }

    private func attach() {
        webView.load(URLRequest(url: origin.url))
    }

    private func configureFindBar(in root: NSView) {
        findBar.material = .headerView
        findBar.blendingMode = .withinWindow
        findBar.isHidden = true
        findBar.translatesAutoresizingMaskIntoConstraints = false
        findField.placeholderString = "Find"
        findField.target = self
        findField.action = #selector(findNext(_:))
        findField.onCancel = { [weak self] in self?.closeFindBar() }
        findField.translatesAutoresizingMaskIntoConstraints = false
        findResult.textColor = .secondaryLabelColor
        findResult.translatesAutoresizingMaskIntoConstraints = false
        let previous = NSButton(title: "Previous", target: self, action: #selector(findPrevious(_:)))
        let next = NSButton(title: "Next", target: self, action: #selector(findNext(_:)))
        let done = NSButton(title: "Done", target: self, action: #selector(closeFind(_:)))
        let stack = NSStackView(views: [findField, findResult, previous, next, done])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        findBar.addSubview(stack)
        root.addSubview(findBar)
        NSLayoutConstraint.activate([
            findBar.topAnchor.constraint(equalTo: root.topAnchor),
            findBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            findBar.heightAnchor.constraint(equalToConstant: 44),
            stack.leadingAnchor.constraint(equalTo: findBar.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: findBar.trailingAnchor, constant: -12),
            stack.centerYAnchor.constraint(equalTo: findBar.centerYAnchor),
            findField.widthAnchor.constraint(equalToConstant: 240),
        ])
    }

    private func performFind(backwards: Bool) {
        let query = findField.stringValue
        guard !query.isEmpty else {
            findResult.stringValue = ""
            return
        }
        let configuration = WKFindConfiguration()
        configuration.backwards = backwards
        configuration.wraps = true
        webView.find(query, configuration: configuration) { [weak self] result in
            self?.findResult.stringValue = result.matchFound ? "" : "No matches"
        }
    }

    @objc private func closeFind(_ sender: Any?) {
        closeFindBar()
    }

    private func closeFindBar() {
        findBar.isHidden = true
        findResult.stringValue = ""
        view.window?.makeFirstResponder(webView)
    }

    private func register(download: WKDownload, sourceURL: URL?) {
        guard let sourceURL,
              BrowserSecurityPolicy.allowsSessionExport(url: sourceURL, origin: origin)
        else {
            reportedDownloadFailures.insert(ObjectIdentifier(download))
            download.cancel()
            presentDownloadFailure("Blocked a download outside the session export endpoint.")
            return
        }
        approvedDownloads[ObjectIdentifier(download)] = ApprovedDownload(
            sourceURL: sourceURL,
            destination: nil
        )
        activeDownloads[ObjectIdentifier(download)] = download
        download.delegate = self
    }

    private func reportDownloadFailureOnce(_ download: WKDownload, message: String) {
        let identifier = ObjectIdentifier(download)
        guard reportedDownloadFailures.insert(identifier).inserted else { return }
        presentDownloadFailure(message)
    }

    private func clearDownload(_ download: WKDownload) {
        let identifier = ObjectIdentifier(download)
        approvedDownloads.removeValue(forKey: identifier)?.destination?.discard()
        activeDownloads.removeValue(forKey: identifier)
        cancelledDownloads.remove(identifier)
        reportedDownloadFailures.remove(identifier)
    }

    private func presentDownloadFailure(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Download blocked"
        alert.informativeText = message
        if let window = view.window {
            alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
    }

    private func isCancellation(_ error: Error) -> Bool {
        let error = error as NSError
        return error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled
    }
}
