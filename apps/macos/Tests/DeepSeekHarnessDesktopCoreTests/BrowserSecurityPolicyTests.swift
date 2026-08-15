import Foundation
import DeepSeekHarnessDesktopCore

enum BrowserSecurityPolicyTests {
    static func run() throws {
        let origin = try LoopbackOrigin("http://127.0.0.1:3210")
        try expect(
            BrowserSecurityPolicy.allowsSubframe(
                url: URL(string: "http://127.0.0.1:3210/frame")!,
                origin: origin
            ),
            "same-origin subframe"
        )
        try expect(
            BrowserSecurityPolicy.allowsSubframe(url: URL(string: "about:blank")!, origin: origin),
            "inert blank subframe"
        )
        for value in ["about:srcdoc", "https://example.com/frame", "file:///tmp/frame.html"] {
            try expect(
                !BrowserSecurityPolicy.allowsSubframe(url: URL(string: value)!, origin: origin),
                "reject subframe \(value)"
            )
        }

        try expect(
            BrowserSecurityPolicy.allowsSessionExport(
                url: URL(string: "http://127.0.0.1:3210/api/session.export?id=one")!,
                origin: origin
            ),
            "same-origin export"
        )
        for value in [
            "http://127.0.0.1:3210/api/session.export/extra",
            "http://127.0.0.1:3210/api/other",
            "http://127.0.0.1:3211/api/session.export",
            "https://example.com/api/session.export",
        ] {
            try expect(
                !BrowserSecurityPolicy.allowsSessionExport(url: URL(string: value)!, origin: origin),
                "reject download \(value)"
            )
        }
        try expect(BrowserSecurityPolicy.isAttachmentDisposition("attachment; filename=export.md"), "attachment header")
        try expect(BrowserSecurityPolicy.isAttachmentDisposition(" ATTACHMENT "), "case-insensitive attachment")
        try expect(!BrowserSecurityPolicy.isAttachmentDisposition("inline; filename=export.md"), "reject inline")
        try expect(!BrowserSecurityPolicy.isAttachmentDisposition(nil), "reject absent disposition")
        try expect(
            BrowserSecurityPolicy.allowsFileSelection(
                scheme: "http", host: "127.0.0.1", port: 3210, origin: origin
            ),
            "same-origin file selection"
        )
        try expect(
            !BrowserSecurityPolicy.allowsFileSelection(
                scheme: "https", host: "127.0.0.1", port: 3210, origin: origin
            ),
            "reject file selection from other security origin"
        )

        var recovery = WebContentRecoveryBudget(maximumAutomaticReloads: 1)
        try expect(recovery.claimAutomaticReload(), "first automatic recovery")
        try expect(!recovery.claimAutomaticReload(), "bounded automatic recovery")
    }
}
