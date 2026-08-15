import Foundation

/// A user-selected final export URL and its same-directory download staging URL.
public struct SessionExportDestination: Equatable, Sendable {
    public let finalURL: URL
    public let stagingURL: URL

    /// Creates a destination that preserves an existing file until download success.
    /// - Parameters:
    ///   - finalURL: URL explicitly selected through NSSavePanel.
    ///   - identifier: Unique staging suffix.
    public init(finalURL: URL, identifier: UUID = UUID()) {
        self.finalURL = finalURL
        stagingURL = finalURL.deletingLastPathComponent()
            .appendingPathComponent(".\(finalURL.lastPathComponent).download-\(identifier.uuidString)")
    }

    /// Atomically replaces an existing selection or moves a new completed export into place.
    /// - Parameter fileManager: Filesystem implementation used for the final commit.
    public func commit(fileManager: FileManager = .default) throws {
        if fileManager.fileExists(atPath: finalURL.path) {
            _ = try fileManager.replaceItemAt(finalURL, withItemAt: stagingURL)
        } else {
            try fileManager.moveItem(at: stagingURL, to: finalURL)
        }
    }

    /// Removes an incomplete staging file without changing the selected final URL.
    /// - Parameter fileManager: Filesystem implementation used for cleanup.
    public func discard(fileManager: FileManager = .default) {
        try? fileManager.removeItem(at: stagingURL)
    }
}
