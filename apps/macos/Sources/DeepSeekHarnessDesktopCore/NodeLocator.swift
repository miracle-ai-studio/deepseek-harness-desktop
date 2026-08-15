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
        if let override = environment["DSH_NODE_BINARY"], !override.isEmpty {
            let candidate = URL(fileURLWithPath: override)
            if isExecutableRegularFile(candidate, fileManager: fileManager) { return candidate }
        }

        for path in standardCandidatePaths {
            let candidate = URL(fileURLWithPath: path)
            if isExecutableRegularFile(candidate, fileManager: fileManager) { return candidate }
        }

        let pathValue = environment["PATH"] ?? ""
        for directory in pathValue.split(separator: ":", omittingEmptySubsequences: true) {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("node")
            if fileManager.isExecutableFile(atPath: candidate.path) { return candidate }
        }

        throw NodeLocatorError.notFound
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
    case notFound

    public var errorDescription: String? {
        switch self {
        case .notFound:
            return "未找到可用的开发运行时。请重新检查开发环境配置。"
        }
    }
}
