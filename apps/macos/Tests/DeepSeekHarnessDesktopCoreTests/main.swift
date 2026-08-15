import Foundation

let tests: [(String, () throws -> Void)] = [
    ("ApplicationArguments", ApplicationArgumentsTests.run),
    ("BrowserSecurityPolicy", BrowserSecurityPolicyTests.run),
    ("LoopbackOrigin", LoopbackOriginTests.run),
    ("HarnessRootLocator", HarnessRootLocatorTests.run),
    ("HostReadiness", HostReadinessTests.run),
    ("NodeLocator", NodeLocatorTests.run),
    ("ProcessOwnership", ProcessOwnershipTests.run),
    ("SessionExportDestination", SessionExportDestinationTests.run),
    ("StartupPresentationState", StartupPresentationStateTests.run),
]

do {
    for (name, test) in tests {
        try test()
        print("PASS \(name)")
    }
} catch {
    FileHandle.standardError.write(Data("FAIL: \(error.localizedDescription)\n".utf8))
    exit(1)
}
