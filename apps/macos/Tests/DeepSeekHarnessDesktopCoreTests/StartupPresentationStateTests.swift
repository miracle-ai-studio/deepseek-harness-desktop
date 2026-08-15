import DeepSeekHarnessDesktopCore

enum StartupPresentationStateTests {
    static func run() throws {
        var state = StartupPresentationState()
        try expect(state.animationPlan == .stopped, "hidden loading view stays stopped")

        state.setVisible(true)
        state.showLoading(reducesMotion: false)
        try expect(state.animationPlan == .animatedLoading, "visible loading animates")

        state.setReducesMotion(true)
        try expect(state.animationPlan == .staticLoading, "Reduce Motion is static")

        state.showFailure()
        try expect(state.animationPlan == .stopped, "failure stops loading animations")

        state.showLoading(reducesMotion: false)
        try expect(state.animationPlan == .animatedLoading, "retry restarts while visible")

        state.setVisible(false)
        try expect(state.animationPlan == .stopped, "disappearing stops animations")
    }
}
