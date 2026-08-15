// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "DeepSeekHarnessDesktop",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "DeepSeekHarnessDesktopCore", targets: ["DeepSeekHarnessDesktopCore"]),
        .executable(name: "DeepSeekHarnessDesktop", targets: ["DeepSeekHarnessDesktop"]),
        .executable(name: "DeepSeekHarnessDesktopCoreTests", targets: ["DeepSeekHarnessDesktopCoreTests"]),
    ],
    targets: [
        .target(name: "DeepSeekHarnessDesktopCore"),
        .executableTarget(name: "DeepSeekHarnessDesktop", dependencies: ["DeepSeekHarnessDesktopCore"]),
        .executableTarget(
            name: "DeepSeekHarnessDesktopCoreTests",
            dependencies: ["DeepSeekHarnessDesktopCore"],
            path: "Tests/DeepSeekHarnessDesktopCoreTests"
        ),
    ]
)
