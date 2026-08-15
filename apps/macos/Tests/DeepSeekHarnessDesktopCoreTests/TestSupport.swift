import Foundation

struct TestFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw TestFailure(message: message) }
}

func expect<T: Equatable>(_ actual: T, equals expected: T, _ message: String) throws {
    try expect(actual == expected, message)
}

func expectThrows(_ message: String, _ body: () throws -> Void) throws {
    do {
        try body()
        throw TestFailure(message: message)
    } catch is TestFailure {
        throw TestFailure(message: message)
    } catch {}
}
