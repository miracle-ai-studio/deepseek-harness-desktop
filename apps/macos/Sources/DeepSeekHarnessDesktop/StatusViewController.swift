import AppKit
import QuartzCore
import DeepSeekHarnessDesktopCore

private final class StartupBeamView: NSView {
    private let gradient = CAGradientLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        gradient.startPoint = CGPoint(x: 0, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        gradient.colors = [
            NSColor.labelColor.withAlphaComponent(0).cgColor,
            NSColor.labelColor.withAlphaComponent(0.95).cgColor,
            NSColor.labelColor.withAlphaComponent(0).cgColor,
        ]
        layer?.addSublayer(gradient)
        layer?.shadowColor = NSColor.labelColor.cgColor
        layer?.shadowOpacity = 0.42
        layer?.shadowRadius = 5
        layer?.shadowOffset = .zero
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        gradient.frame = bounds
    }
}

/// Displays native startup progress and actionable failures before WebKit appears.
final class StatusViewController: NSViewController {
    private let iconView = NSImageView(image: StatusViewController.loadGlyph())
    private let titleLabel = NSTextField(labelWithString: "正在启动 DeepSeek Harness…")
    private let detailLabel = NSTextField(wrappingLabelWithString: "正在等待本地服务准备就绪。")
    private let activityTrack = NSView()
    private let activityBeam = StartupBeamView()
    private let retryButton = NSButton(title: "重试", target: nil, action: nil)
    private var retryAction: (() -> Void)?
    private var presentationState = StartupPresentationState()
    private var accessibilityObserver: NSObjectProtocol?

    deinit {
        if let accessibilityObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(accessibilityObserver)
        }
    }

    override func loadView() {
        view = NSView()
        configureGlyph()
        configureActivityTrack()
        titleLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.alignment = .center
        detailLabel.maximumNumberOfLines = 12

        retryButton.target = self
        retryButton.action = #selector(retry(_:))
        retryButton.isHidden = true
        let stack = NSStackView(views: [iconView, titleLabel, detailLabel, activityTrack, retryButton])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 48),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -48),
            detailLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 680),
        ])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.presentationState.setReducesMotion(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            self.applyAnimationPlan()
        }
    }

    override func viewWillAppear() {
        super.viewWillAppear()
        presentationState.setVisible(true)
        presentationState.setReducesMotion(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        startPresentationAnimations()
    }

    override func viewWillDisappear() {
        super.viewWillDisappear()
        presentationState.setVisible(false)
        stopAnimations()
        setStaticLayerState()
    }

    func show(error: String, retry: @escaping () -> Void) {
        _ = view
        presentationState.showFailure()
        titleLabel.stringValue = "无法打开 DeepSeek Harness"
        detailLabel.stringValue = "启动或连接本地服务时发生错误。\n\n错误详情：\n\(error)"
        detailLabel.textColor = .labelColor
        retryAction = retry
        retryButton.isHidden = false
        activityTrack.isHidden = true
        applyAnimationPlan()
        view.window?.makeFirstResponder(retryButton)
        NSAccessibility.post(
            element: titleLabel,
            notification: .announcementRequested,
            userInfo: [
                .announcement: "无法打开 DeepSeek Harness。请查看错误详情或重试。",
                .priority: NSAccessibilityPriorityLevel.high.rawValue,
            ]
        )
    }

    func showLoading() {
        _ = view
        presentationState.showLoading(
            reducesMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        )
        retryAction = nil
        retryButton.isHidden = true
        activityTrack.isHidden = false
        titleLabel.stringValue = "正在启动 DeepSeek Harness…"
        detailLabel.stringValue = "正在等待本地服务准备就绪。"
        detailLabel.textColor = .secondaryLabelColor
        applyAnimationPlan()
    }

    @objc private func retry(_ sender: Any?) {
        retryAction?()
    }

    private static func loadGlyph() -> NSImage {
        guard let url = Bundle.main.url(forResource: "DeepSeekGlyph", withExtension: "svg"),
              let image = NSImage(contentsOf: url)
        else {
            return NSImage(size: NSSize(width: 72, height: 72))
        }
        image.isTemplate = true
        return image
    }

    private func configureGlyph() {
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.contentTintColor = .labelColor
        iconView.wantsLayer = true
        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 72),
            iconView.heightAnchor.constraint(equalToConstant: 72),
        ])
        iconView.setAccessibilityLabel("DeepSeek Harness")
    }

    private func configureActivityTrack() {
        activityTrack.translatesAutoresizingMaskIntoConstraints = false
        activityTrack.wantsLayer = true
        activityTrack.layer?.backgroundColor = NSColor.separatorColor.withAlphaComponent(0.32).cgColor
        activityTrack.layer?.cornerRadius = 1
        activityBeam.translatesAutoresizingMaskIntoConstraints = false
        activityTrack.addSubview(activityBeam)
        NSLayoutConstraint.activate([
            activityTrack.widthAnchor.constraint(equalToConstant: 240),
            activityTrack.heightAnchor.constraint(equalToConstant: 2),
            activityBeam.centerXAnchor.constraint(equalTo: activityTrack.centerXAnchor),
            activityBeam.centerYAnchor.constraint(equalTo: activityTrack.centerYAnchor),
            activityBeam.widthAnchor.constraint(equalToConstant: 72),
            activityBeam.heightAnchor.constraint(equalToConstant: 2),
        ])
        activityTrack.setAccessibilityElement(false)
    }

    private func applyAnimationPlan() {
        stopAnimations()
        setStaticLayerState()
        switch presentationState.animationPlan {
        case .stopped, .staticLoading:
            return
        case .animatedLoading:
            addGlyphEntryAnimation()
            addBeamSweepAnimation()
        }
    }

    private func startPresentationAnimations() {
        applyAnimationPlan()
    }

    private func stopAnimations() {
        iconView.layer?.removeAllAnimations()
        activityBeam.layer?.removeAllAnimations()
    }

    private func setStaticLayerState() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        iconView.layer?.opacity = 1
        iconView.layer?.transform = CATransform3DIdentity
        activityBeam.layer?.opacity = presentationState.mode == .loading ? 0.78 : 0
        activityBeam.layer?.transform = CATransform3DIdentity
        CATransaction.commit()
    }

    private func addGlyphEntryAnimation() {
        guard let layer = iconView.layer else { return }
        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 0
        opacity.toValue = 1
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.9
        scale.toValue = 1
        let group = CAAnimationGroup()
        group.animations = [opacity, scale]
        group.duration = 0.3
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        layer.add(group, forKey: "startup-glyph-entry")
    }

    private func addBeamSweepAnimation() {
        guard let layer = activityBeam.layer else { return }
        let translation = CAKeyframeAnimation(keyPath: "transform.translation.x")
        translation.values = [-132, 132]
        let opacity = CAKeyframeAnimation(keyPath: "opacity")
        opacity.values = [0, 1, 1, 0]
        opacity.keyTimes = [0, 0.18, 0.82, 1]
        let group = CAAnimationGroup()
        group.animations = [translation, opacity]
        group.duration = 1.65
        group.repeatCount = .infinity
        group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(group, forKey: "startup-light-sweep")
    }
}
