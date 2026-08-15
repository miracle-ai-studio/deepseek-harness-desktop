import Foundation

/// Resolves the Node executable used for owner-mode Host startup.
public enum NodeLocator {
    /// Resolves Node using the Finder-safe precedence defined by the desktop contract.
    /// - Parameters:
    ///   - environment: The application environment.
    ///   - standardCandidatePaths: Finder-safe absolute Node candidates in precedence order.
    ///   - fileManager: Filesystem access used for candidate validation.
    /// - Returns: An executable Node URL.
    public static func locate(
        environment: [String: String],
        standardCandidatePaths: [String] = ["/opt/homebrew/bin/node", "/usr/local/bin/node"],
        fileManager: FileManager = .default
    ) throws -> URL {
        var attempted: [String] = []
        if let override = environment["DSH_NODE_BINARY"], !override.isEmpty {
            attempted.append("DSH_NODE_BINARY=\(override)")
            let candidate = URL(fileURLWithPath: override)
            if isExecutableRegularFile(candidate, fileManager: fileManager) { return candidate }
        } else {
            attempted.append("DSH_NODE_BINARY (unset)")
        }

        for path in standardCandidatePaths {
            attempted.append(path)
            let candidate = URL(fileURLWithPath: path)
            if isExecutableRegularFile(candidate, fileManager: fileManager) { return candidate }
        }

        let pathValue = environment["PATH"] ?? ""
        attempted.append("node through PATH=\(pathValue)")
        for directory in pathValue.split(separator: ":", omittingEmptySubsequences: true) {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("node")
            if fileManager.isExecutableFile(atPath: candidate.path) { return candidate }
        }

        throw NodeLocatorError.notFound(attempted: attempted)
    }

    private static func isExecutableRegularFile(_ url: URL, fileManager: FileManager) -> Bool {
        let resolved = url.resolvingSymlinksInPath()
        guard fileManager.isExecutableFile(atPath: resolved.path),
              let attributes = try? fileManager.attributesOfItem(atPath: resolved.path),
              attributes[.type] as? FileAttributeType == .typeRegular
        else {
            return false
        }
        return true
    }
}

/// Failures from resolving Node for owner mode.
public enum NodeLocatorError: LocalizedError, Equatable {
    case notFound(attempted: [String])

    public var errorDescription: String? {
        switch self {
        case .notFound(let attempted):
            return "Node executable not found. Checked: \(attempted.joined(separator: ", "))."
        }
    }
}
