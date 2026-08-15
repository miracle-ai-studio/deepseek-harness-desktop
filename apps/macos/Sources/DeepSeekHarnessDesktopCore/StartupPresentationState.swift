/// Visible content mode of the native startup surface.
public enum StartupPresentationMode: Equatable, Sendable {
    case loading
    case failure
}

/// Animation behavior derived from visibility, content mode, and accessibility settings.
public enum StartupAnimationPlan: Equatable, Sendable {
    case stopped
    case staticLoading
    case animatedLoading
}

/// Pure lifecycle state for the pre-WebView native startup presentation.
public struct StartupPresentationState: Equatable, Sendable {
    public private(set) var mode: StartupPresentationMode = .loading
    public private(set) var isVisible = false
    public private(set) var reducesMotion = false

    public init() {}

    /// Updates whether the status controller is on screen.
    /// - Parameter isVisible: Current AppKit visibility.
    public mutating func setVisible(_ isVisible: Bool) {
        self.isVisible = isVisible
    }

    /// Selects loading presentation and the current motion preference.
    /// - Parameter reducesMotion: Current system Reduce Motion value.
    public mutating func showLoading(reducesMotion: Bool) {
        mode = .loading
        self.reducesMotion = reducesMotion
    }

    /// Selects the non-animated failure presentation.
    public mutating func showFailure() {
        mode = .failure
    }

    /// Updates the motion preference without changing the visible status.
    /// - Parameter reducesMotion: Current system Reduce Motion value.
    public mutating func setReducesMotion(_ reducesMotion: Bool) {
        self.reducesMotion = reducesMotion
    }

    /// Animation plan for the current lifecycle state.
    public var animationPlan: StartupAnimationPlan {
        guard isVisible, mode == .loading else { return .stopped }
        return reducesMotion ? .staticLoading : .animatedLoading
    }
}
