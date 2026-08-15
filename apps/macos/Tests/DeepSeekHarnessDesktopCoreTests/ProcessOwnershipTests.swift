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

        var termination = OwnedProcessTerminationState()
        try expect(termination.request() == .startAttempt, "first termination starts")
        try expect(termination.request() == .joinAttempt, "concurrent termination joins")
        termination.complete(didExit: false)
        try expect(termination.request() == .startAttempt, "failed termination remains retryable")
        termination.complete(didExit: true)
        try expect(termination.request() == .alreadyExited, "exited child completes immediately")
    }
}
