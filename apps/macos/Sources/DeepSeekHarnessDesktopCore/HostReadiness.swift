import Foundation

/// Configured Host readiness deadline and its exact diagnostic representation.
public struct HostReadinessDeadline: Equatable, Sendable {
    public static let defaultSeconds: TimeInterval = 60
    public let seconds: TimeInterval

    /// Creates a positive readiness deadline.
    /// - Parameter seconds: Maximum wait before owner-mode startup fails.
    public init(seconds: TimeInterval = Self.defaultSeconds) {
        precondition(seconds > 0)
        self.seconds = seconds
    }

    /// Seconds rendered without inventing a different timeout value.
    public var diagnosticSeconds: String {
        seconds.rounded() == seconds ? String(Int(seconds)) : String(seconds)
    }
}

/// Parses the exact readiness record emitted by the Harness Web bundle.
public enum HostReadiness {
    private static let prefix = "dsh web: "

    /// Parses one complete output line.
    /// - Parameter line: A single line without its newline terminator.
    /// - Returns: The declared loopback origin, or `nil` for any other output.
    public static func parse(line: String) -> LoopbackOrigin? {
        let normalized = line.last == "\r" ? String(line.dropLast()) : line
        guard normalized.hasPrefix(prefix) else { return nil }
        let rawURL = String(normalized.dropFirst(prefix.count))
        guard !rawURL.isEmpty, !rawURL.contains(" "),
              let origin = try? LoopbackOrigin(rawURL),
              rawURL == origin.url.absoluteString
        else {
            return nil
        }
        return origin
    }
}

/// Incrementally separates merged Host output into complete lines.
public struct HostOutputScanner: Sendable {
    private var pending = ""

    public init() {}

    /// Appends decoded process output and returns a readiness origin when observed.
    /// - Parameter text: A decoded output fragment.
    /// - Returns: The first readiness origin found in newly completed lines.
    public mutating func append(_ text: String) -> LoopbackOrigin? {
        pending += text
        var readiness: LoopbackOrigin?
        while let newline = pending.firstIndex(of: "\n") {
            let line = String(pending[..<newline])
            pending.removeSubrange(...newline)
            readiness = readiness ?? HostReadiness.parse(line: line)
        }
        return readiness
    }
}
