import Foundation
import DeepSeekHarnessDesktopCore

enum ProcessOwnershipTests {
    static func run() throws {
        try expect(!HostProcessOwnership.attached.terminatesOnApplicationExit, "attached Host ownership")
        try expect(HostProcessOwnership.childStartedByApplication.terminatesOnApplicationExit, "owned Host ownership")
        let specification = HostLaunchSpecification.owner(
            nodeURL: URL(fileURLWithPath: "/node"),
            harnessRoot: URL(fileURLWithPath: "/harness"),
            profile: "web",
            environment: ["EXISTING": "yes"]
        )
        try expect(specification.arguments == [
            "--import", "tsx/esm", "apps/cli/src/bin.ts", "--profile", "web", "--port", "0",
        ], "semantic Host arguments")
        try expect(specification.environment["DSH_DESKTOP_APP_OWNS_HOST"] == "1", "recursion fence")
        try expect(specification.environment["EXISTING"] == "yes", "environment preservation")
        try expect(specification.ownership == .childStartedByApplication, "specification ownership")

        let embeddedRuntime = EmbeddedHostRuntime(
            nodeURL: URL(fileURLWithPath: "/app/runtime/node"),
            hostEntryURL: URL(fileURLWithPath: "/app/runtime/host/bin.js"),
            webFrontendURL: URL(fileURLWithPath: "/app/runtime/host/index.html")
        )
        let embedded = HostLaunchSpecification.embeddedOwner(
            runtime: embeddedRuntime,
            profile: "web",
            environment: ["DSH_HARNESS_ROOT": "/private/source", "DSH_NODE_BINARY": "/private/node"],
            workingDirectoryURL: URL(fileURLWithPath: "/home")
        )
        try expect(embedded.arguments == [
            "/app/runtime/host/bin.js", "--profile", "web", "--port", "0",
        ], "embedded Host arguments")
        try expect(embedded.environment["DSH_HARNESS_ROOT"] == nil, "embedded Host removes source override")
        try expect(embedded.environment["DSH_NODE_BINARY"] == nil, "embedded Host removes Node override")

        var termination = OwnedProcessTerminationState()
        try expect(termination.request() == .startAttempt, "first termination starts")
        try expect(termination.request() == .joinAttempt, "concurrent termination joins")
        termination.complete(didExit: false)
        try expect(termination.request() == .startAttempt, "failed termination remains retryable")
        termination.complete(didExit: true)
        try expect(termination.request() == .alreadyExited, "exited child completes immediately")
    }
}
