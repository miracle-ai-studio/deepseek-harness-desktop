import Foundation

/// The startup mode selected by the desktop command line.
public enum StartupMode: Equatable, Sendable {
    case attach(LoopbackOrigin)
    case owner
}

/// Validated options used to start the desktop application.
public struct ApplicationArguments: Equatable, Sendable {
    public let mode: StartupMode
    public let harnessRoot: String?
    public let profile: String

    /// Parses application arguments without the executable name.
    /// - Parameter arguments: Arguments supplied after the executable name.
    /// - Returns: Validated desktop startup options.
    public static func parse(_ arguments: [String]) throws -> ApplicationArguments {
        var url: LoopbackOrigin?
        var harnessRoot: String?
        var profile: String?
        var index = 0

        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--url":
                guard url == nil else { throw ArgumentError.duplicate(argument) }
                url = try LoopbackOrigin(try value(after: argument, at: index, in: arguments))
                index += 2
            case "--harness-root":
                guard harnessRoot == nil else { throw ArgumentError.duplicate(argument) }
                harnessRoot = try value(after: argument, at: index, in: arguments)
                index += 2
            case "--profile":
                guard profile == nil else { throw ArgumentError.duplicate(argument) }
                profile = try value(after: argument, at: index, in: arguments)
                index += 2
            default:
                throw ArgumentError.unknown(argument)
            }
        }

        return ApplicationArguments(
            mode: url.map(StartupMode.attach) ?? .owner,
            harnessRoot: harnessRoot,
            profile: profile ?? "web"
        )
    }

    private static func value(after option: String, at index: Int, in arguments: [String]) throws -> String {
        let valueIndex = index + 1
        guard valueIndex < arguments.count, !arguments[valueIndex].hasPrefix("--") else {
            throw ArgumentError.missingValue(option)
        }
        let value = arguments[valueIndex]
        guard !value.isEmpty else { throw ArgumentError.emptyValue(option) }
        return value
    }
}

/// User-facing failures from desktop command-line parsing.
public enum ArgumentError: LocalizedError, Equatable {
    case unknown(String)
    case missingValue(String)
    case emptyValue(String)
    case duplicate(String)

    public var errorDescription: String? {
        switch self {
        case .unknown(let argument): return "Unknown argument: \(argument)"
        case .missingValue(let argument): return "Missing value for \(argument)"
        case .emptyValue(let argument): return "Empty value for \(argument)"
        case .duplicate(let argument): return "Duplicate argument: \(argument)"
        }
    }
}
