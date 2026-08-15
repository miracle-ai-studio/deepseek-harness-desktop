import Foundation

/// Security decisions shared by the native WebKit delegates.
public enum BrowserSecurityPolicy {
    /// Reports whether a subframe may navigate without escaping the attached Host.
    /// - Parameters:
    ///   - url: Requested frame URL.
    ///   - origin: Validated Host origin.
    /// - Returns: `true` for the exact Host origin or an inert `about:blank` document.
    public static func allowsSubframe(url: URL, origin: LoopbackOrigin) -> Bool {
        if origin.contains(url) { return true }
        return url.absoluteString == "about:blank"
    }

    /// Reports whether a URL is the one native download endpoint.
    /// - Parameters:
    ///   - url: Candidate download URL.
    ///   - origin: Validated Host origin.
    /// - Returns: `true` only for same-origin `/api/session.export` requests.
    public static func allowsSessionExport(url: URL, origin: LoopbackOrigin) -> Bool {
        guard origin.contains(url),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return false
        }
        return components.path == "/api/session.export" && components.fragment == nil
    }

    /// Reports whether a file chooser request came from the exact attached origin.
    /// - Parameters:
    ///   - scheme: WebKit security-origin protocol.
    ///   - host: WebKit security-origin host.
    ///   - port: WebKit security-origin port.
    ///   - origin: Validated Host origin.
    /// - Returns: `true` only for the attached loopback origin.
    public static func allowsFileSelection(
        scheme: String,
        host: String,
        port: Int,
        origin: LoopbackOrigin
    ) -> Bool {
        scheme == "http" && host == "127.0.0.1" && port == origin.port
    }

    /// Reports whether an HTTP content-disposition value explicitly requests a download.
    /// - Parameter value: Raw Content-Disposition header value.
    /// - Returns: `true` only when the disposition token is `attachment`.
    public static func isAttachmentDisposition(_ value: String?) -> Bool {
        guard let token = value?
            .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: true)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        else {
            return false
        }
        return token == "attachment"
    }
}

/// A lifetime-bounded automatic recovery allowance for one browser controller.
public struct WebContentRecoveryBudget: Equatable, Sendable {
    public let maximumAutomaticReloads: Int
    public private(set) var automaticReloads = 0

    /// Creates a bounded recovery budget.
    /// - Parameter maximumAutomaticReloads: Non-negative automatic reload limit.
    public init(maximumAutomaticReloads: Int = 1) {
        precondition(maximumAutomaticReloads >= 0)
        self.maximumAutomaticReloads = maximumAutomaticReloads
    }

    /// Claims one automatic reload when the lifetime limit has not been exhausted.
    /// - Returns: Whether the caller may reload.
    public mutating func claimAutomaticReload() -> Bool {
        guard automaticReloads < maximumAutomaticReloads else { return false }
        automaticReloads += 1
        return true
    }
}
