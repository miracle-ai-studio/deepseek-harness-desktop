import Foundation

/// States which component owns Host lifecycle cleanup.
public enum HostProcessOwnership: Equatable, Sendable {
    case attached
    case childStartedByApplication

    /// Whether application shutdown must terminate the Host process.
    public var terminatesOnApplicationExit: Bool {
        self == .childStartedByApplication
    }
}

/// Decision made when one caller requests termination of an owned child.
public enum TerminationRequestDecision: Equatable, Sendable {
    case startAttempt
    case joinAttempt
    case alreadyExited
}

/// Retry-safe state for an asynchronous owned-child termination handshake.
public struct OwnedProcessTerminationState: Equatable, Sendable {
    public private(set) var hasExited = false
    public private(set) var attemptInProgress = false

    public init() {}

    /// Registers a termination request without treating a failed attempt as child exit.
    /// - Returns: Whether to start, join, or immediately complete the request.
    public mutating func request() -> TerminationRequestDecision {
        if hasExited { return .alreadyExited }
        if attemptInProgress { return .joinAttempt }
        attemptInProgress = true
        return .startAttempt
    }

    /// Completes the current attempt and preserves retryability after failure.
    /// - Parameter didExit: Whether the exact owned child has exited.
    public mutating func complete(didExit: Bool) {
        attemptInProgress = false
        if didExit { hasExited = true }
    }
}

/// Process construction for owner-mode Host startup.
public struct HostLaunchSpecification: Equatable, Sendable {
    public let executableURL: URL
    public let arguments: [String]
    public let workingDirectoryURL: URL
    public let environment: [String: String]
    public let ownership: HostProcessOwnership

    /// Builds the semantic source-launch command required by the desktop contract.
    /// - Parameters:
    ///   - nodeURL: Resolved Node executable.
    ///   - harnessRoot: Existing Harness checkout.
    ///   - profile: Cordis profile name.
    ///   - environment: Parent process environment.
    /// - Returns: The owned Host process specification.
    public static func owner(
        nodeURL: URL,
        harnessRoot: URL,
        profile: String,
        environment: [String: String]
    ) -> HostLaunchSpecification {
        var childEnvironment = environment
        childEnvironment["DSH_DESKTOP_APP_OWNS_HOST"] = "1"
        return HostLaunchSpecification(
            executableURL: nodeURL,
            arguments: [
                "--import", "tsx/esm", "apps/cli/src/bin.ts",
                "--profile", profile,
                "--port", "0",
            ],
            workingDirectoryURL: harnessRoot,
            environment: childEnvironment,
            ownership: .childStartedByApplication
        )
    }

    /// Builds the owner-mode command for a relocatable embedded runtime.
    public static func embeddedOwner(
        runtime: EmbeddedHostRuntime,
        profile: String,
        environment: [String: String],
        workingDirectoryURL: URL
    ) -> HostLaunchSpecification {
        var childEnvironment = environment
        childEnvironment["DSH_DESKTOP_APP_OWNS_HOST"] = "1"
        childEnvironment.removeValue(forKey: "DSH_HARNESS_ROOT")
        childEnvironment.removeValue(forKey: "DSH_NODE_BINARY")
        return HostLaunchSpecification(
            executableURL: runtime.nodeURL,
            arguments: [
                runtime.hostEntryURL.path,
                "--profile", profile,
                "--port", "0",
            ],
            workingDirectoryURL: workingDirectoryURL,
            environment: childEnvironment,
            ownership: .childStartedByApplication
        )
    }
}
