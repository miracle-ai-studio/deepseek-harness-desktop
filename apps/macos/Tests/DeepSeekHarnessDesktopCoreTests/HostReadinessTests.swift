import DeepSeekHarnessDesktopCore

enum HostReadinessTests {
    static func run() throws {
        let defaultDeadline = HostReadinessDeadline()
        try expect(defaultDeadline.seconds == 60, "cold-start readiness default")
        try expect(defaultDeadline.diagnosticSeconds == "60", "default timeout diagnostic")
        try expect(
            HostReadinessDeadline(seconds: 2.5).diagnosticSeconds == "2.5",
            "configured timeout diagnostic"
        )
        try expect(
            HostReadiness.parse(line: "dsh web: http://127.0.0.1:49152"),
            equals: try LoopbackOrigin("http://127.0.0.1:49152"),
            "exact readiness"
        )
        try expect(HostReadiness.parse(line: "ready http://127.0.0.1:49152") == nil, "reject other prefix")
        try expect(HostReadiness.parse(line: "dsh web: http://localhost:49152") == nil, "reject localhost")
        try expect(HostReadiness.parse(line: "dsh web: http://127.0.0.1:49152/") == nil, "reject readiness slash")
        try expect(HostReadiness.parse(line: "dsh web: http://127.0.0.1:49152 extra") == nil, "reject readiness suffix")
        var scanner = HostOutputScanner()
        try expect(scanner.append("loading\ndsh web: http://127.") == nil, "fragment stays pending")
        try expect(
            scanner.append("0.0.1:43210\nmore\n"),
            equals: try LoopbackOrigin("http://127.0.0.1:43210"),
            "fragmented readiness"
        )
    }
}
