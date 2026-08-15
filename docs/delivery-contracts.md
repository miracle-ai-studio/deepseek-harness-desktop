# DeepSeek Harness Desktop delivery contracts

This file is the shared implementation contract for parallel development. Changes to a cross-component field, command, lifecycle rule, or owned path require the primary agent to update this file before dependent implementations change.

## Product boundary

DeepSeek Harness Desktop is one macOS application with two entry paths:

1. Cordis starts the JavaScript plugin, which attaches or launches the application after the existing Web Host is ready.
2. A user double-clicks the application, which starts the existing DeepSeek Harness Web Host and then attaches its window.

The native application is a client surface, not a second agent Host. Cordis and the existing Harness packages remain authoritative for sessions, tools, permissions, approvals, and persistence. The application owns only macOS process integration, windows, navigation, and presentation.

## Component contract

| Component | Owned paths | Direct deliverable |
| --- | --- | --- |
| Cordis plugin | `packages/cordis-plugin/**`, `bundle/**`, `tests/plugin/**` | A TypeScript Cordis plugin and bundle patch that can be referenced by `cordis.yml`, waits for the existing Web Host, and launches or attaches the native application. |
| macOS application | `apps/macos/**`, `tests/swift/**` | A SwiftPM AppKit/WebKit application that attaches to a supplied Host URL or starts the existing Harness Web Host when opened directly. |
| Integration tooling | `scripts/**`, `tests/integration/**` | Deterministic scripts that build an `.app`, stage a production Host dependency closure from the sibling Harness checkout without modifying it, and verify the assembled startup interfaces. |
| Primary integration | Root files, `docs/**`, final cross-component fixes | Root build configuration, user documentation, contract governance, assembled verification, and final acceptance. |

Agents must not edit paths owned by another component. They may report a contract mismatch to the primary agent instead of adapting the other component implicitly.

## Stable names and locations

- Product name: `DeepSeek Harness Desktop`
- Bundle identifier: `ai.deepseek.harness.desktop`
- Cordis package: `@deepseek-ai/dsh-macos-surface`
- Development application output: `dist/DeepSeek Harness Desktop.app`
- Consumer application output: `dist/release/DeepSeek Harness Desktop.app`
- Embedded Node executable: `Contents/Resources/runtime/node/bin/node`
- Embedded Host entry: `Contents/Resources/runtime/host/node_modules/@deepseek-ai/dsh/lib/bin.js`
- Harness checkout resolution order:
  1. `DSH_HARNESS_ROOT`
  2. sibling directory `../deepseek-harness` relative to this repository
- Default Harness profile: `web`

## Native application command-line interface

The executable supports these arguments:

```text
DeepSeek Harness Desktop [--url <http://127.0.0.1:PORT>] [--harness-root <path>] [--profile <name>]
```

- `--url` selects attach mode. The application must not start or terminate the Host in this mode.
- Without `--url`, the application selects owner mode. A consumer build starts its embedded Host with its embedded Node executable; a development build without embedded artifacts falls back to the documented source-checkout discovery. In both cases it starts the Web profile on an OS-assigned loopback port and terminates only that child process during application shutdown.
- `--harness-root` overrides Harness discovery for owner mode.
- `--profile` defaults to `web`.
- Unknown arguments, missing values, invalid non-loopback URLs, startup failure, and early Host exit must produce a visible error and a non-zero command-line diagnostic where applicable.

The consumer application launches the embedded production entry with this semantic command:

```text
Contents/Resources/runtime/node/bin/node Contents/Resources/runtime/host/node_modules/@deepseek-ai/dsh/lib/bin.js --profile <profile> --port 0
```

Its working directory is the user's home directory, not the read-only application bundle. The embedded runtime is authoritative whenever its manifest is present: a partial or damaged embedded runtime fails closed and never silently falls back to a developer checkout.

A development application without an embedded manifest launches the source checkout with this semantic command:

```text
node --import tsx/esm apps/cli/src/bin.ts --profile <profile> --port 0
```

The working directory is the resolved Harness root. The exact launcher may resolve `node` and `tsx` paths without changing these arguments.

Development owner mode resolves the Node executable in this order: `DSH_NODE_BINARY`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, then `node` through the inherited `PATH`. A candidate must be an executable regular file, except the final `PATH` lookup. User-visible failure text must not echo candidate paths, environment values, source anchors, usernames, or other build-machine locations.

## Embedded runtime assembly

The consumer release stages the existing Harness runtime rather than reimplementing it:

1. The staging tool reads a named Harness checkout and works only in an isolated temporary clone, leaving the checkout unchanged.
2. It builds the Harness packages, computes the production workspace dependency and required-peer closure rooted at `@deepseek-ai/dsh` plus the Web frontend, and deploys that closure with production dependencies only.
3. It materializes all package symlinks so the application bundle is relocatable, and rejects any remaining symbolic link or missing CLI/Web entrypoint.
4. It downloads the pinned official macOS Node archive over HTTPS, verifies its committed SHA-256 digest, and embeds the executable with its license.
5. Assembly writes a versioned runtime manifest containing only product versions, architecture, relative entrypoints, and archive digests. No absolute source, package-store, cache, home-directory, or temporary path may be written to the application, disk image, logs shown to users, documentation, or release metadata.

The release build fails before publication if runtime closure, entrypoint, architecture, relocation, or path-hygiene verification fails. Generated runtime content remains ignored and is never committed.

## Host readiness interface

The existing Web bundle emits the following readiness line only after Cordis loader settlement:

```text
dsh web: http://127.0.0.1:<port>
```

Owner mode reads merged child output until that exact loopback URL form appears, then loads it in WebKit. A configurable 60-second deadline is the default because a cold source launch can begin listening near the 30-second mark before Cordis loader settlement. Output before readiness is retained for diagnostics. No other log line implies readiness.

## Cordis plugin interface

The plugin exports the conventional Cordis `name`, `inject`, `Config`, and `apply` surface. Its configuration is:

```ts
interface Config {
  applicationPath?: string
  launchMode?: 'launch-if-needed' | 'attach-only'
  launchTimeoutMs?: number
}
```

- The shipped profile patch sets `applicationPath` from `DSH_DESKTOP_APP_PATH`, then `/Applications/DeepSeek Harness Desktop.app`. A raw plugin row that omits the field falls back to `DSH_DESKTOP_APP_PATH`, then `dist/DeepSeek Harness Desktop.app` relative to a source checkout.
- `launchMode` defaults to `launch-if-needed`.
- `launchTimeoutMs` defaults to 30,000 and must be positive.
- The plugin requires the existing `webServer` service and waits for loader settlement before resolving `http://127.0.0.1:<webServer.port>`.
- If `DSH_DESKTOP_APP_OWNS_HOST=1`, the plugin performs no application launch. This prevents owner-mode recursion.
- `attach-only` validates the resolved attachment, logs the exact line `dsh desktop: <resolved-url>`, and starts no process. It does not add a Cordis service. `launch-if-needed` starts the application executable with `--url <resolved-url>`.
- The plugin owns only a process it starts and registers cleanup through Cordis effects. It must not terminate an already-running application.
- Missing application artifacts and launch failures fail loudly with actionable paths.

The plugin package itself is also the external bundle artifact: `packages/cordis-plugin/package.json` declares a `dsh.bundle` manifest whose `patch` is `./cordis.patch.yml`, and that adjacent file is the single canonical patch. The patch adds the plugin after the standard `web-app` bundle composition; it does not duplicate Host services. No second npm bundle package or duplicated patch file is created.

## Environment interface

| Variable | Producer | Consumer | Meaning |
| --- | --- | --- | --- |
| `DSH_HARNESS_ROOT` | User/tooling | App and scripts | Explicit existing Harness checkout. |
| `DSH_DESKTOP_APP_PATH` | User/tooling | Plugin | Explicit `.app` location. |
| `DSH_NODE_BINARY` | User/tooling | App owner mode | Explicit Node executable for Finder launches. |
| `DSH_DESKTOP_APP_OWNS_HOST=1` | App owner mode | Child Host/plugin | Suppress recursive native-app launch. |

## WebKit and security contract

- Top-level navigation is restricted to the exact attached loopback origin. External links open in the system browser.
- TLS challenges, arbitrary file URLs, non-loopback attachment URLs, and new WebKit windows are rejected or redirected safely.
- Subframe navigation is restricted to the attached origin and inert `about:blank` documents. Web content cannot embed arbitrary remote frames.
- Same-origin `/api/session.export` navigation marked for download is handled by `WKDownload` and an `NSSavePanel`. Cancellation writes nothing and is not an application failure; redirects, authentication challenges, and every other download path fail closed.
- HTML file inputs use `WKOpenPanelParameters` and an application-owned `NSOpenPanel`. This chooser returns only the URLs explicitly selected by the user and does not expose a general filesystem bridge.
- Camera and microphone requests are denied until a separately documented product capability supplies purpose strings, a Host policy, and an origin-scoped user gesture.
- Web content process termination triggers a bounded automatic reload. Navigation failure and exhausted recovery show a native status page with a retry action; retry reattaches to the same validated origin, or starts a fresh owned Host after an owned Host exit.
- The MVP reuses the current loopback reachability model. It does not claim that loopback alone authenticates the desktop client. Authenticated loopback transport is a required hardening item before distribution to untrusted local environments.
- Web content cannot invoke native shell APIs directly. Shell permissions and approvals remain inside the existing Host capability and policy plugins.

## macOS interaction contract

- Cut, Copy, Paste, and Select All use the AppKit responder chain so WKWebView emits the corresponding DOM editing events.
- Undo and Redo remain owned by the Web composer transaction machine. Native menu key equivalents must not intercept them until a typed Desktop command interface invokes that same machine.
- The application provides standard Close Window, Reload, Find, Actual Size, Zoom In, Zoom Out, Enter Full Screen, Minimize, Zoom Window, and Bring All to Front commands. Page commands target the active browser controller; window commands use the AppKit responder chain.
- Native Find uses `WKWebView.find` and never injects `window.find()` or queries product DOM nodes.
- Closing the last window still means quitting. In owner mode, application termination is delayed until the exact owned Host child exits, with a bounded graceful interval followed by forced termination. Attach mode never terminates the Host.
- The application does not add native tabs, a general JavaScript message handler, native shell execution, or a native approval decision path.

## Startup presentation contract

- Owner-mode startup uses a native AppKit loading view, not a second HTML document or WebView. Its visible loading, failure, and retry text is Simplified Chinese.
- The official DeepSeek SVG glyph is rendered as a monochrome template without an icon tile or colored background, so it follows the current macOS label color. It enters with a short fade-and-scale motion. Loading activity is a restrained horizontal light sweep rather than a spinner, halo, or activity dots. Animation uses layer transforms and opacity rather than layout constraints.
- Reduce Motion disables repeating and spatial motion while preserving a clear static loading state. Animations stop whenever the status view is no longer visible and restart only while loading.
- The animation adds no JavaScript runtime or GSAP package to the native application. Its timing follows the selected GSAP core principles while AppKit/Core Animation remains the implementation appropriate to the pre-WebView startup phase.

## Acceptance contract

The assembled result is accepted when:

1. TypeScript plugin unit tests prove URL resolution, recursion suppression, configuration rejection, launch arguments, failure reporting, and disposer ownership.
2. Swift tests prove argument parsing, loopback validation, Harness root discovery, readiness parsing, and process-ownership decisions.
3. `swift build` succeeds with the installed Command Line Tools.
4. The tooling creates `dist/DeepSeek Harness Desktop.app` with the declared bundle identifier and executable.
5. A keyless integration smoke verifies the plugin package/bundle metadata and native executable interface.
6. When the existing Harness dependencies are available, an assembled smoke starts the Web Host, observes its declared readiness line, and attaches the application without starting a second Host.
7. A consumer smoke relocates the application away from both repositories, launches owner mode with isolated user state and no development overrides, observes Host readiness, and confirms the embedded process is the only Host it owns.
8. A release audit scans the application and disk image for absolute build paths, usernames, environment/configuration files, credentials, unresolved symlinks, and missing runtime licenses before any GitHub asset is uploaded.
