import Foundation
import Darwin
import DeepSeekHarnessDesktopCore

enum HostProcessEvent {
    case ready(LoopbackOrigin)
    case failed(String)
}

/// Runs and drains the one Host process owned by an owner-mode application.
final class OwnedHostProcess {
    private let process: Process
    private let outputPipe = Pipe()
    private let queue = DispatchQueue(label: "ai.deepseek.harness.desktop.host-output")
    private var scanner = HostOutputScanner()
    private var reportedReadiness = false
    private var reportedFailure = false
    private var stopping = false
    private var terminationState = OwnedProcessTerminationState()
    private var stopCompletions: [(Bool) -> Void] = []
    private var deadline: DispatchWorkItem?
    private var forcedTermination: DispatchWorkItem?
    private var readinessDeadline = HostReadinessDeadline()
    private let onEvent: (HostProcessEvent) -> Void

    init(specification: HostLaunchSpecification, onEvent: @escaping (HostProcessEvent) -> Void) {
        process = Process()
        process.executableURL = specification.executableURL
        process.arguments = specification.arguments
        process.currentDirectoryURL = specification.workingDirectoryURL
        process.environment = specification.environment
        process.standardOutput = outputPipe
        process.standardError = outputPipe
        self.onEvent = onEvent
    }

    func start(timeout: TimeInterval = 60) throws {
        readinessDeadline = HostReadinessDeadline(seconds: timeout)
        outputPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consume(String(decoding: data, as: UTF8.self))
        }
        process.terminationHandler = { [weak self] process in
            self?.queue.async { self?.processTerminated(status: process.terminationStatus) }
        }
        try process.run()

        let workItem = DispatchWorkItem { [weak self] in self?.timedOut() }
        deadline = workItem
        queue.asyncAfter(deadline: .now() + timeout, execute: workItem)
    }

    /// Stops the exact owned child and reports only after it exits.
    /// - Parameters:
    ///   - gracefulTimeout: Delay before escalating from SIGTERM to SIGKILL.
    ///   - completion: Receives `true` after child exit, or `false` if forced termination cannot be sent.
    func stopAndWait(gracefulTimeout: TimeInterval = 2, completion: @escaping (Bool) -> Void) {
        queue.async { [self] in
            switch self.terminationState.request() {
            case .alreadyExited:
                DispatchQueue.main.async { completion(true) }
                return
            case .joinAttempt:
                self.stopCompletions.append(completion)
                return
            case .startAttempt:
                self.stopCompletions.append(completion)
            }
            self.stopping = true
            self.deadline?.cancel()
            self.outputPipe.fileHandleForReading.readabilityHandler = nil
            guard self.process.isRunning else {
                self.finishStop(didExit: true)
                return
            }
            self.process.terminate()
            let force = DispatchWorkItem { [self] in self.forceTermination() }
            self.forcedTermination = force
            self.queue.asyncAfter(deadline: .now() + gracefulTimeout, execute: force)
        }
    }

    private func consume(_ text: String) {
        queue.async { [weak self] in
            guard let self else { return }
            guard !self.reportedReadiness, let origin = self.scanner.append(text) else { return }
            self.reportedReadiness = true
            self.deadline?.cancel()
            self.deliver(.ready(origin))
        }
    }

    private func timedOut() {
        guard !reportedReadiness, !reportedFailure, !stopping else { return }
        reportedFailure = true
        if process.isRunning { process.terminate() }
        deliver(.failed("本地服务未能在 \(readinessDeadline.diagnosticSeconds) 秒内完成启动，请重试。"))
    }

    private func processTerminated(status: Int32) {
        deadline?.cancel()
        outputPipe.fileHandleForReading.readabilityHandler = nil
        if stopping {
            finishStop(didExit: true)
            return
        }
        guard !reportedFailure else { return }
        reportedFailure = true
        let phase = reportedReadiness ? "启动后" : "准备完成前"
        deliver(.failed("本地服务在\(phase)退出（状态 \(status)），请重试。"))
    }

    private func deliver(_ event: HostProcessEvent) {
        DispatchQueue.main.async { [onEvent] in onEvent(event) }
    }

    private func forceTermination() {
        guard terminationState.attemptInProgress else { return }
        guard process.isRunning else {
            finishStop(didExit: true)
            return
        }
        let processIdentifier = process.processIdentifier
        guard kill(processIdentifier, SIGKILL) == 0 else {
            if process.isRunning {
                finishStop(didExit: false)
            } else {
                finishStop(didExit: true)
            }
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            self.process.waitUntilExit()
            self.queue.async { [self] in self.finishStop(didExit: true) }
        }
    }

    private func finishStop(didExit: Bool) {
        guard terminationState.attemptInProgress else { return }
        terminationState.complete(didExit: didExit)
        stopping = false
        deadline?.cancel()
        forcedTermination?.cancel()
        forcedTermination = nil
        outputPipe.fileHandleForReading.readabilityHandler = nil
        let completions = stopCompletions
        stopCompletions.removeAll()
        DispatchQueue.main.async {
            for completion in completions { completion(didExit) }
        }
    }
}
