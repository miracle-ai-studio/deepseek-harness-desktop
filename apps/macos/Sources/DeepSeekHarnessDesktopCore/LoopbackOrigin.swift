import Foundation

/// An HTTP origin on the exact IPv4 loopback host used by the Harness Web Host.
public struct LoopbackOrigin: Equatable, Hashable, Sendable {
    public let url: URL
    public let port: Int

    /// Validates and normalizes a loopback origin.
    /// - Parameter value: An origin such as `http://127.0.0.1:3000`.
    public init(_ value: String) throws {
        guard let components = URLComponents(string: value),
              components.scheme == "http",
              components.host == "127.0.0.1",
              let port = components.port,
              (1...65_535).contains(port),
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else {
            throw LoopbackOriginError.invalid(value)
        }
        self.port = port
        self.url = URL(string: "http://127.0.0.1:\(port)")!
    }

    /// Reports whether a URL belongs to this exact scheme, host, and port.
    /// - Parameter candidate: A URL requested by WebKit.
    /// - Returns: `true` only for this origin.
    public func contains(_ candidate: URL) -> Bool {
        guard let components = URLComponents(url: candidate, resolvingAgainstBaseURL: false) else { return false }
        return components.scheme == "http"
            && components.host == "127.0.0.1"
            && components.port == port
            && components.user == nil
            && components.password == nil
    }
}

/// Validation failures for desktop attachment origins.
public enum LoopbackOriginError: LocalizedError, Equatable {
    case invalid(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let value):
            return "Invalid desktop URL '\(value)'; expected http://127.0.0.1:<port>"
        }
    }
}
