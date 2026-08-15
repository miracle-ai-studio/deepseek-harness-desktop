import Foundation
import DeepSeekHarnessDesktopCore

enum NodeLocatorTests {
    static func run() throws {
        let temporaryDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let overrideNode = try makeExecutable(at: temporaryDirectory.appendingPathComponent("override-node"))
        let standardNode = try makeExecutable(at: temporaryDirectory.appendingPathComponent("standard-node"))
        let pathDirectory = temporaryDirectory.appendingPathComponent("bin")
        let pathNode = try makeExecutable(at: pathDirectory.appendingPathComponent("node"))

        let overrideResult = try NodeLocator.locate(
            environment: ["DSH_NODE_BINARY": overrideNode.path, "PATH": pathDirectory.path],
            standardCandidatePaths: [standardNode.path]
        )
        try expect(overrideResult == overrideNode, "Node override precedence")

        let standardResult = try NodeLocator.locate(
            environment: ["PATH": pathDirectory.path],
            standardCandidatePaths: [standardNode.path]
        )
        try expect(standardResult == standardNode, "standard Node precedence")
        let pathResult = try NodeLocator.locate(
            environment: ["PATH": pathDirectory.path],
            standardCandidatePaths: [temporaryDirectory.appendingPathComponent("missing").path]
        )
        try expect(pathResult == pathNode, "PATH Node fallback")
        let missingOverride = temporaryDirectory.appendingPathComponent("override").path
        let missingStandard = temporaryDirectory.appendingPathComponent("standard").path
        do {
            _ = try NodeLocator.locate(
                environment: ["DSH_NODE_BINARY": missingOverride, "PATH": "/missing/bin"],
                standardCandidatePaths: [missingStandard]
            )
            throw TestFailure(message: "missing Node must fail")
        } catch let error as NodeLocatorError {
            let message = error.localizedDescription
            try expect(message.contains("DSH_NODE_BINARY=\(missingOverride)"), "failure reports override")
            try expect(message.contains(missingStandard), "failure reports standard candidate")
            try expect(message.contains("PATH=/missing/bin"), "failure reports PATH")
        }
    }

    private static func makeExecutable(at url: URL) throws -> URL {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\n".utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }
}
