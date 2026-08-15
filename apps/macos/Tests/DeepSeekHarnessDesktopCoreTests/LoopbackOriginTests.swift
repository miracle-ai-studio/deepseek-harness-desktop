import Foundation
import DeepSeekHarnessDesktopCore

enum LoopbackOriginTests {
    static func run() throws {
        let origin = try LoopbackOrigin("http://127.0.0.1:3000/")
        try expect(origin.url.absoluteString == "http://127.0.0.1:3000", "origin normalization")
        try expect(origin.contains(URL(string: "http://127.0.0.1:3000/session?id=1")!), "same origin path")
        for value in [
            "https://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.2:3000",
            "http://user@127.0.0.1:3000", "http://127.0.0.1", "file:///tmp/index.html",
            "http://127.0.0.1:3000/path", "http://127.0.0.1:3000?query=1",
        ] {
            try expectThrows("must reject \(value)") { _ = try LoopbackOrigin(value) }
        }
        try expect(!origin.contains(URL(string: "http://127.0.0.1:3001")!), "reject other port")
        try expect(!origin.contains(URL(string: "https://127.0.0.1:3000")!), "reject TLS")
        try expect(!origin.contains(URL(string: "http://localhost:3000")!), "reject localhost alias")
    }
}
