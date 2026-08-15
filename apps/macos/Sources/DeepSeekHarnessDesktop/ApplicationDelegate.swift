import AppKit
import DeepSeekHarnessDesktopCore

/// Coordinates native windows and the one explicitly owned Host process.
final class ApplicationDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private static let initialContentSize = NSSize(width: 1180, height: 780)
    private static let minimumContentSize = NSSize(width: 760, height: 520)

    private let arguments: ApplicationArguments
    private var window: NSWindow?
    private var browserController: BrowserViewController?
    private var hostProcess: OwnedHostProcess?
    private let statusController = StatusViewController()
    private var terminationPending = false

    init(arguments: ApplicationArguments) {
        self.arguments = arguments
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
        switch arguments.mode {
        case .attach(let origin):
            showBrowser(origin: origin)
        case .owner:
            showStatusWindow()
            startOwnedHost()
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let hostProcess else { return .terminateNow }
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        hostProcess.stopAndWait { [weak self] didExit in
            guard let self else {
                sender.reply(toApplicationShouldTerminate: didExit)
                return
            }
            self.terminationPending = false
            if didExit {
                self.hostProcess = nil
            } else {
                self.show(
                    error: "The owned Harness Host could not be terminated. Application exit was cancelled.",
                    retry: { NSApplication.shared.terminate(nil) }
                )
            }
            sender.reply(toApplicationShouldTerminate: didExit)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        let browserActions: Set<Selector> = [
            #selector(reloadPage(_:)), #selector(showFind(_:)), #selector(findNext(_:)),
            #selector(findPrevious(_:)), #selector(actualSize(_:)), #selector(zoomIn(_:)),
            #selector(zoomOut(_:)),
        ]
        if let action = menuItem.action, browserActions.contains(action) {
            return browserController != nil
        }
        return true
    }

    @objc private func reloadPage(_ sender: Any?) { browserController?.reloadPage(sender) }
    @objc private func showFind(_ sender: Any?) { browserController?.showFind(sender) }
    @objc private func findNext(_ sender: Any?) { browserController?.findNext(sender) }
    @objc private func findPrevious(_ sender: Any?) { browserController?.findPrevious(sender) }
    @objc private func actualSize(_ sender: Any?) { browserController?.actualSize(sender) }
    @objc private func zoomIn(_ sender: Any?) { browserController?.zoomIn(sender) }
    @objc private func zoomOut(_ sender: Any?) { browserController?.zoomOut(sender) }

    private func startOwnedHost() {
        statusController.showLoading()
        do {
            let environment = ProcessInfo.processInfo.environment
            let harnessRoot = try HarnessRootLocator.locate(
                commandLineRoot: arguments.harnessRoot,
                environment: environment,
                executableURL: URL(fileURLWithPath: CommandLine.arguments[0])
            )
            let nodeURL = try NodeLocator.locate(environment: environment)
            let specification = HostLaunchSpecification.owner(
                nodeURL: nodeURL,
                harnessRoot: harnessRoot,
                profile: arguments.profile,
                environment: environment
            )
            let child = OwnedHostProcess(specification: specification) { [weak self] event in
                switch event {
                case .ready(let origin):
                    self?.showBrowser(origin: origin)
                case .failed(let message):
                    self?.show(error: message, retry: { [weak self] in self?.restartOwnedHost() })
                }
            }
            hostProcess = child
            try child.start()
        } catch {
            show(error: error.localizedDescription, retry: { [weak self] in self?.restartOwnedHost() })
        }
    }

    private func restartOwnedHost() {
        showStatusWindow()
        statusController.showLoading()
        guard let hostProcess else {
            startOwnedHost()
            return
        }
        hostProcess.stopAndWait { [weak self] didExit in
            guard let self else { return }
            if didExit {
                self.hostProcess = nil
                self.startOwnedHost()
            } else {
                self.show(
                    error: "The previous owned Harness Host could not be stopped.",
                    retry: { [weak self] in self?.restartOwnedHost() }
                )
            }
        }
    }

    private func showStatusWindow() {
        browserController = nil
        if let window {
            if window.contentViewController !== statusController {
                replaceContentViewController(statusController, in: window)
            }
        } else {
            window = makeWindow(contentViewController: statusController)
        }
        window?.makeKeyAndOrderFront(nil)
    }

    private func showBrowser(origin: LoopbackOrigin) {
        let browser = BrowserViewController(origin: origin) { [weak self] message in
            self?.show(error: message, retry: { [weak self] in self?.showBrowser(origin: origin) })
        }
        browserController = browser
        if let window {
            replaceContentViewController(browser, in: window)
            window.title = "DeepSeek Harness"
        } else {
            window = makeWindow(contentViewController: browser)
        }
        window?.makeKeyAndOrderFront(nil)
        browser.focusWebContent()
    }

    private func show(error: String, retry: @escaping () -> Void) {
        showStatusWindow()
        statusController.show(error: error, retry: retry)
        fputs("DeepSeek Harness Desktop: \(error)\n", stderr)
    }

    private func makeWindow(contentViewController: NSViewController) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.initialContentSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DeepSeek Harness"
        window.contentMinSize = Self.minimumContentSize
        window.contentViewController = contentViewController
        window.setContentSize(Self.initialContentSize)
        window.center()
        window.tabbingMode = .disallowed
        window.isRestorable = false
        return window
    }

    private func replaceContentViewController(_ controller: NSViewController, in window: NSWindow) {
        let currentSize = window.contentView?.bounds.size ?? Self.initialContentSize
        window.contentViewController = controller
        window.setContentSize(NSSize(
            width: max(currentSize.width, Self.minimumContentSize.width),
            height: max(currentSize.height, Self.minimumContentSize.height)
        ))
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        installApplicationMenu(in: mainMenu)
        installFileMenu(in: mainMenu)
        installEditMenu(in: mainMenu)
        installViewMenu(in: mainMenu)
        installWindowMenu(in: mainMenu)
        NSApplication.shared.mainMenu = mainMenu
    }

    private func installApplicationMenu(in mainMenu: NSMenu) {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: "DeepSeek Harness Desktop")
        menu.addItem(withTitle: "About DeepSeek Harness Desktop", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: "Services")
        services.submenu = servicesMenu
        menu.addItem(services)
        NSApplication.shared.servicesMenu = servicesMenu
        menu.addItem(.separator())
        menu.addItem(withTitle: "Hide DeepSeek Harness Desktop", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = menu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        menu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit DeepSeek Harness Desktop", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = menu
    }

    private func installFileMenu(in mainMenu: NSMenu) {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: "File")
        menu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        item.submenu = menu
    }

    private func installEditMenu(in mainMenu: NSMenu) {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: "Edit")
        menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        menu.addItem(.separator())
        let findItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        let findMenu = NSMenu(title: "Find")
        let find = findMenu.addItem(withTitle: "Find…", action: #selector(showFind(_:)), keyEquivalent: "f")
        find.target = self
        let next = findMenu.addItem(withTitle: "Find Next", action: #selector(findNext(_:)), keyEquivalent: "g")
        next.target = self
        let previous = findMenu.addItem(withTitle: "Find Previous", action: #selector(findPrevious(_:)), keyEquivalent: "g")
        previous.keyEquivalentModifierMask = [.command, .shift]
        previous.target = self
        findItem.submenu = findMenu
        menu.addItem(findItem)
        item.submenu = menu
    }

    private func installViewMenu(in mainMenu: NSMenu) {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: "View")
        for specification in [
            ("Reload", #selector(reloadPage(_:)), "r"),
            ("Actual Size", #selector(actualSize(_:)), "0"),
            ("Zoom In", #selector(zoomIn(_:)), "+"),
            ("Zoom Out", #selector(zoomOut(_:)), "-"),
        ] {
            let command = menu.addItem(withTitle: specification.0, action: specification.1, keyEquivalent: specification.2)
            command.target = self
        }
        menu.addItem(.separator())
        let fullScreen = menu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        item.submenu = menu
    }

    private func installWindowMenu(in mainMenu: NSMenu) {
        let item = NSMenuItem()
        mainMenu.addItem(item)
        let menu = NSMenu(title: "Window")
        menu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menu.addItem(withTitle: "Zoom Window", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        item.submenu = menu
        NSApplication.shared.windowsMenu = menu
    }
}
