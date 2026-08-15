import Foundation
import DeepSeekHarnessDesktopCore

enum SessionExportDestinationTests {
    static func run() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let finalURL = root.appendingPathComponent("session.md")
        try Data("old".utf8).write(to: finalURL)
        let destination = SessionExportDestination(
            finalURL: finalURL,
            identifier: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        )
        try expect(
            destination.stagingURL.deletingLastPathComponent().standardizedFileURL.path
                == root.standardizedFileURL.path,
            "same-directory staging"
        )
        try Data("new".utf8).write(to: destination.stagingURL)
        try destination.commit()
        let committed = try String(contentsOf: finalURL, encoding: .utf8)
        try expect(committed == "new", "successful atomic replacement")
        try expect(!FileManager.default.fileExists(atPath: destination.stagingURL.path), "commit consumes staging")

        let preserved = SessionExportDestination(finalURL: finalURL)
        try Data("partial".utf8).write(to: preserved.stagingURL)
        preserved.discard()
        preserved.discard()
        let afterDiscard = try String(contentsOf: finalURL, encoding: .utf8)
        try expect(afterDiscard == "new", "failed download preserves final")
        try expect(!FileManager.default.fileExists(atPath: preserved.stagingURL.path), "discard removes staging")
    }
}
