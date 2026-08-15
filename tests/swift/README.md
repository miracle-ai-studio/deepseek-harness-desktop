# Swift test location

The executable package owns its Swift checks under `apps/macos/Tests`. The installed Command Line Tools omit both XCTest and Swift Testing, so the checks use a dependency-free Swift executable that imports the production Core module:

```sh
swift run --package-path apps/macos DeepSeekHarnessDesktopCoreTests
```
