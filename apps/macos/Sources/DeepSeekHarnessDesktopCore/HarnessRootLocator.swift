import Foundation

/// Resolves and validates the existing DeepSeek Harness source checkout.
public enum HarnessRootLocator {
    /// Locates the Harness checkout using the documented override order.
    /// - Parameters:
    ///   - commandLineRoot: The optional `--harness-root` value.
    ///   - environment: The process environment.
    ///   - executableURL: The desktop executable path.
    ///   - sourceFileURL: A source anchor used by SwiftPM development builds.
    ///   - fileManager: Filesystem access used for validation.
    /// - Returns: A standardized checkout directory URL.
    public static func locate(
        commandLineRoot: String?,
        environment: [String: String],
        executableURL: URL,
        sourceFileURL: URL = URL(fileURLWithPath: #filePath),
        fileManager: FileManager = .default
    ) throws -> URL {
        var candidates: [URL] = []
        if let commandLineRoot {
            candidates.append(URL(fileURLWithPath: commandLineRoot))
        } else if let environmentRoot = environment["DSH_HARNESS_ROOT"], !environmentRoot.isEmpty {
            candidates.append(URL(fileURLWithPath: environmentRoot))
        } else {
            if let repositoryRoot = desktopRepositoryRoot(containing: executableURL) {
                candidates.append(repositoryRoot.deletingLastPathComponent().appendingPathComponent("deepseek-harness"))
            }
            let packageRoot = sourceFileURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
            let desktopRepositoryRoot = packageRoot.deletingLastPathComponent().deletingLastPathComponent()
            candidates.append(desktopRepositoryRoot.deletingLastPathComponent().appendingPathComponent("deepseek-harness"))
        }

        for candidate in candidates {
            let standardized = candidate.standardizedFileURL
            if fileManager.fileExists(atPath: standardized.appendingPathComponent("apps/cli/src/bin.ts").path) {
                return standardized
            }
        }

        let searched = candidates.map(\.standardizedFileURL.path).joined(separator: ", ")
        throw HarnessRootError.notFound(searched: searched)
    }

    private static func desktopRepositoryRoot(containing executableURL: URL) -> URL? {
        let macOSDirectory = executableURL.deletingLastPathComponent()
        guard macOSDirectory.lastPathComponent == "MacOS" else { return nil }
        let contentsDirectory = macOSDirectory.deletingLastPathComponent()
        guard contentsDirectory.lastPathComponent == "Contents" else { return nil }
        let applicationURL = contentsDirectory.deletingLastPathComponent()
        guard applicationURL.pathExtension == "app" else { return nil }
        return applicationURL.deletingLastPathComponent().deletingLastPathComponent()
    }
}

/// Failures from locating an existing Harness checkout.
public enum HarnessRootError: LocalizedError, Equatable {
    case notFound(searched: String)

    public var errorDescription: String? {
        switch self {
        case .notFound(let searched):
            return "DeepSeek Harness checkout not found. Searched: \(searched). Set DSH_HARNESS_ROOT or pass --harness-root."
        }
    }
}
