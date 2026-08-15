import Foundation
import DeepSeekHarnessDesktopCore

enum HarnessRootLocatorTests {
    static func run() throws {
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

        let commandLine = try makeHarness(named: "command-line", in: temporaryDirectory)
        let environment = try makeHarness(named: "environment", in: temporaryDirectory)
        let result = try HarnessRootLocator.locate(
            commandLineRoot: commandLine.path,
            environment: ["DSH_HARNESS_ROOT": environment.path],
            executableURL: URL(fileURLWithPath: "/irrelevant"),
            sourceFileURL: URL(fileURLWithPath: "/irrelevant")
        )
        try expect(result == commandLine.standardizedFileURL, "command-line root precedence")
        let executable = temporaryDirectory
            .appendingPathComponent("deepseek-harness-desktop/dist/Desktop.app/Contents/MacOS/Desktop")
        let environmentResult = try HarnessRootLocator.locate(
            commandLineRoot: nil,
            environment: ["DSH_HARNESS_ROOT": environment.path],
            executableURL: executable,
            sourceFileURL: URL(fileURLWithPath: "/irrelevant")
        )
        try expect(environmentResult == environment.standardizedFileURL, "environment root precedence")
        let desktopRoot = temporaryDirectory.appendingPathComponent("deepseek-harness-desktop")
        let sibling = temporaryDirectory.appendingPathComponent("deepseek-harness")
        try createHarness(at: sibling)
        let bundledExecutable = desktopRoot.appendingPathComponent("dist/Desktop.app/Contents/MacOS/Desktop")
        let siblingResult = try HarnessRootLocator.locate(
            commandLineRoot: nil,
            environment: [:],
            executableURL: bundledExecutable,
            sourceFileURL: URL(fileURLWithPath: "/irrelevant")
        )
        try expect(siblingResult == sibling.standardizedFileURL, "bundled sibling discovery")
        try expectThrows("missing checkout must fail") {
            _ = try HarnessRootLocator.locate(
                commandLineRoot: temporaryDirectory.appendingPathComponent("missing").path,
                environment: [:],
                executableURL: URL(fileURLWithPath: "/irrelevant"),
                sourceFileURL: URL(fileURLWithPath: "/irrelevant")
            )
        }
    }

    private static func makeHarness(named name: String, in temporaryDirectory: URL) throws -> URL {
        let root = temporaryDirectory.appendingPathComponent(name)
        try createHarness(at: root)
        return root
    }

    private static func createHarness(at root: URL) throws {
        let entrypoint = root.appendingPathComponent("apps/cli/src/bin.ts")
        try FileManager.default.createDirectory(at: entrypoint.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: entrypoint)
    }
}
