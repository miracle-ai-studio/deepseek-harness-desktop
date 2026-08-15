import Foundation

/// A relocatable Host runtime carried inside a consumer application bundle.
public struct EmbeddedHostRuntime: Equatable, Sendable {
    public let nodeURL: URL
    public let hostEntryURL: URL
    public let webFrontendURL: URL

    public init(nodeURL: URL, hostEntryURL: URL, webFrontendURL: URL) {
        self.nodeURL = nodeURL
        self.hostEntryURL = hostEntryURL
        self.webFrontendURL = webFrontendURL
    }
}

private struct EmbeddedRuntimeManifest: Decodable {
    let formatVersion: Int
    let nodeExecutable: String
    let hostEntry: String
    let webFrontend: String
}

/// Resolves only application-relative runtime paths and rejects partial bundles.
public enum EmbeddedRuntimeLocator {
    public static func locate(
        executableURL: URL,
        fileManager: FileManager = .default
    ) throws -> EmbeddedHostRuntime? {
        guard let resourcesURL = applicationResources(containing: executableURL) else { return nil }
        let runtimeURL = resourcesURL.appendingPathComponent("runtime", isDirectory: true)
        let manifestURL = runtimeURL.appendingPathComponent("manifest.json")
        guard fileManager.fileExists(atPath: manifestURL.path) else { return nil }

        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(EmbeddedRuntimeManifest.self, from: data),
              manifest.formatVersion == 1,
              let nodeURL = safeRuntimeURL(manifest.nodeExecutable, under: runtimeURL),
              let hostEntryURL = safeRuntimeURL(manifest.hostEntry, under: runtimeURL),
              let webFrontendURL = safeRuntimeURL(manifest.webFrontend, under: runtimeURL),
              isExecutableRegularFile(nodeURL, fileManager: fileManager),
              isReadableRegularFile(hostEntryURL, fileManager: fileManager),
              isReadableRegularFile(webFrontendURL, fileManager: fileManager)
        else {
            throw EmbeddedRuntimeError.invalidBundle
        }

        return EmbeddedHostRuntime(
            nodeURL: nodeURL,
            hostEntryURL: hostEntryURL,
            webFrontendURL: webFrontendURL
        )
    }

    private static func applicationResources(containing executableURL: URL) -> URL? {
        let macOSDirectory = executableURL.standardizedFileURL.deletingLastPathComponent()
        guard macOSDirectory.lastPathComponent == "MacOS" else { return nil }
        let contentsDirectory = macOSDirectory.deletingLastPathComponent()
        guard contentsDirectory.lastPathComponent == "Contents" else { return nil }
        let applicationURL = contentsDirectory.deletingLastPathComponent()
        guard applicationURL.pathExtension == "app" else { return nil }
        return contentsDirectory.appendingPathComponent("Resources", isDirectory: true)
    }

    private static func safeRuntimeURL(_ relativePath: String, under runtimeURL: URL) -> URL? {
        guard !relativePath.isEmpty, !relativePath.hasPrefix("/"), !relativePath.contains("\\") else { return nil }
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        let candidate = components.reduce(runtimeURL) { partial, component in
            partial.appendingPathComponent(String(component))
        }.standardizedFileURL
        let prefix = runtimeURL.standardizedFileURL.path + "/"
        guard candidate.path.hasPrefix(prefix) else { return nil }
        return candidate
    }

    private static func isExecutableRegularFile(_ url: URL, fileManager: FileManager) -> Bool {
        guard fileManager.isExecutableFile(atPath: url.path),
              let attributes = try? fileManager.attributesOfItem(atPath: url.path),
              attributes[.type] as? FileAttributeType == .typeRegular
        else { return false }
        return true
    }

    private static func isReadableRegularFile(_ url: URL, fileManager: FileManager) -> Bool {
        guard fileManager.isReadableFile(atPath: url.path),
              let attributes = try? fileManager.attributesOfItem(atPath: url.path),
              attributes[.type] as? FileAttributeType == .typeRegular
        else { return false }
        return true
    }
}

public enum EmbeddedRuntimeError: LocalizedError, Equatable {
    case invalidBundle

    public var errorDescription: String? {
        "应用内置运行时不完整或已损坏，请重新下载安装。"
    }
}
