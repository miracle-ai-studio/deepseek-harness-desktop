import AppKit
import Darwin
import DeepSeekHarnessDesktopCore

private func reportCommandLineError(_ error: Error) -> Never {
    let message = "DeepSeek Harness Desktop: \(error.localizedDescription)\n"
    FileHandle.standardError.write(Data(message.utf8))
    exit(2)
}

let arguments: ApplicationArguments
do {
    arguments = try ApplicationArguments.parse(Array(CommandLine.arguments.dropFirst()))
} catch {
    reportCommandLineError(error)
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = ApplicationDelegate(arguments: arguments)
application.delegate = delegate
application.run()
