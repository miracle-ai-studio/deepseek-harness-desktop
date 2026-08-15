import Foundation
import DeepSeekHarnessDesktopCore

enum EmbeddedRuntimeLocatorTests {
    static func run() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("Product.app/Contents/MacOS/Product")
        let runtime = root.appendingPathComponent("Product.app/Contents/Resources/runtime")
        let node = runtime.appendingPathComponent("node/bin/node")
        let host = runtime.appendingPathComponent("host/node_modules/@deepseek-ai/dsh/lib/bin.js")
        let frontend = runtime.appendingPathComponent("host/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html")
        try makeFile(node, executable: true)
        try makeFile(host)
        try makeFile(frontend)
        let manifest = """
        {"formatVersion":1,"nodeExecutable":"node/bin/node","hostEntry":"host/node_modules/@deepseek-ai/dsh/lib/bin.js","webFrontend":"host/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html"}
        """
        try Data(manifest.utf8).write(to: runtime.appendingPathComponent("manifest.json"))

        let located = try EmbeddedRuntimeLocator.locate(executableURL: executable)
        try expect(located?.nodeURL == node.standardizedFileURL, "embedded Node resolution")
        try expect(located?.hostEntryURL == host.standardizedFileURL, "embedded Host resolution")
        try expect(located?.webFrontendURL == frontend.standardizedFileURL, "embedded frontend resolution")

        let developmentExecutable = root.appendingPathComponent("Development.app/Contents/MacOS/Product")
        let developmentRuntime = try EmbeddedRuntimeLocator.locate(executableURL: developmentExecutable)
        try expect(developmentRuntime == nil, "missing manifest selects development mode")

        try Data("{\"formatVersion\":1,\"nodeExecutable\":\"../node\",\"hostEntry\":\"host\",\"webFrontend\":\"web\"}".utf8)
            .write(to: runtime.appendingPathComponent("manifest.json"))
        try expectThrows("escaping runtime path must fail") {
            _ = try EmbeddedRuntimeLocator.locate(executableURL: executable)
        }
    }

    private static func makeFile(_ url: URL, executable: Bool = false) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: url)
        if executable {
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        }
    }
}
