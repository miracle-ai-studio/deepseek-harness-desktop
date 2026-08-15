import DeepSeekHarnessDesktopCore

enum ApplicationArgumentsTests {
    static func run() throws {
        let result = try ApplicationArguments.parse([])
        try expect(result.mode == .owner, "default owner mode")
        try expect(result.harnessRoot == nil, "default root")
        try expect(result.profile == "web", "default profile")
        let attach = try ApplicationArguments.parse(["--url", "http://127.0.0.1:8123"])
        let expectedOrigin = try LoopbackOrigin("http://127.0.0.1:8123")
        try expect(attach.mode == .attach(expectedOrigin), "attach arguments")
        let owner = try ApplicationArguments.parse(["--harness-root", "/checkout", "--profile", "custom"])
        try expect(owner.mode == .owner, "overridden owner mode")
        try expect(owner.harnessRoot == "/checkout", "root override")
        try expect(owner.profile == "custom", "profile override")
        try expectThrows("unknown argument must fail") { _ = try ApplicationArguments.parse(["--other"]) }
        try expectThrows("missing URL must fail") { _ = try ApplicationArguments.parse(["--url"]) }
        try expectThrows("duplicate profile must fail") { _ = try ApplicationArguments.parse(["--profile", "one", "--profile", "two"]) }
        try expectThrows("non-loopback URL must fail") { _ = try ApplicationArguments.parse(["--url", "https://example.com"]) }
    }
}
