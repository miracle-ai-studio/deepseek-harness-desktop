# Architecture

English | [中文](architecture.zh.md)

DeepSeek Harness Desktop adds a macOS presentation layer to the existing DeepSeek Harness Web Host. The architecture keeps one Host as the authority and supports two equivalent entry paths: a user can open the `.app`, or a DSH profile can load the Cordis plugin.

## Goals and boundaries

The design has four invariants:

1. The existing Node/Cordis Host owns sessions, tools, providers, permission policy, approvals, credentials, and persistence.
2. The native application owns macOS presentation and only the child processes it starts.
3. Cordis imports a JavaScript plugin, never a macOS application bundle.
4. Web content receives no general native shell or filesystem bridge.

The project does not fork the Web Client, implement a second Agent Host in Swift, or create a separate desktop session store.

## Components

| Component | Responsibility | Explicit non-responsibility |
| --- | --- | --- |
| DeepSeek Harness Host | Cordis composition, Web server, Agent Loop, sessions, tools, capabilities, permissions, approvals, persistence | macOS windows and application lifecycle |
| `@deepseek-ai/dsh-macos-surface` | DSH bundle layer, Loader/Web Host attachment, companion-app launch, owned cleanup | Host creation, product data, shell execution, permission decisions |
| `DeepSeek Harness Desktop.app` | AppKit lifecycle, native menus, restricted WebKit view, file panels, download destination, startup and error presentation | Agent runtime, product storage, native approval policy |
| Build and smoke tooling | SwiftPM build, `.app` assembly, package checks, cross-process ownership verification | runtime behavior or user data mutation |

The JavaScript package and native application are separate artifacts because their loaders and distribution formats are different. They cooperate through a small process and URL interface rather than sharing an in-process implementation.

## Runtime topology

```text
Direct application launch                     DSH profile launch
          |                                            |
          v                                            v
  macOS application                            existing Cordis Host
          | starts and owns                            |
          v                                            v
  existing Web Host  <---- loopback HTTP ----  macOS surface plugin
          |                                            |
          +------------------+-------------------------+
                             v
                    restricted WKWebView
```

Both paths converge on one Web Host and one native client. Only process ownership differs.

## Startup and lifecycle

### Owner mode

Opening the `.app` without `--url` selects owner mode. A consumer build resolves its Node executable and Harness CLI from the application-relative embedded runtime, then starts the existing Harness `web` profile with port `0`. An embedded manifest is authoritative: a partial runtime fails closed instead of falling back to a developer machine. Source builds without that manifest retain the documented checkout and Node discovery path for development.

The child receives `DSH_DESKTOP_APP_OWNS_HOST=1`. If the desktop Cordis plugin is present in that profile, this recursion fence prevents it from launching a second application.

The application reads merged child output and accepts only the declared readiness line `dsh web: http://127.0.0.1:<port>`. The default deadline is 60 seconds because a cold launch includes Node, module loading, Cordis composition, and Web application settlement. Raw Host output is not echoed into the native failure surface, preventing local paths, environment data, or credentials from appearing in user-visible diagnostics.

When the user quits, AppKit delays termination while the exact owned child receives graceful termination. After a bounded interval, the application may force that same child to exit. No unrelated Host process is discovered or killed.

### Attach mode

When loaded by a profile, the plugin injects the existing `loader` and `webServer` services. After Loader settlement, it derives the exact attachment URL from `webServer.port` and starts the application executable with `--url`.

The application validates that the supplied URL is plain HTTP on `127.0.0.1` with an explicit port. It does not start, restart, or terminate the Host. Cordis effect disposal may terminate only the application process created by that effect.

`attach-only` mode performs the same Host and URL resolution but starts no native process. It prints `dsh desktop: <url>` for another launcher to consume.

## DSH plugin integration

`packages/cordis-plugin/package.json` declares a standard `dsh.bundle` manifest whose `patch` points to the adjacent `cordis.patch.yml`. Installing the package with `dsh plugin --profile <name> add <package>` adds both the package dependency and its ordered bundle layer to the profile.

The patch inserts one `macos-surface` row after the standard Web application composition. That row uses ordinary Cordis dependency injection and configuration. It does not mount another Web server, Loader, Agent Loop, or capability provider.

The plugin exports the conventional Cordis surface:

```ts
export const name = 'macos-surface'
export const inject = ['webServer', 'loader']
export const Config = /* Schemastery schema */
export function apply(ctx, config) { /* owned effect */ }
```

This makes the adapter native to the DSH plugin and profile ecosystem. The `.app` remains a companion artifact because Node module resolution cannot load a macOS application bundle as JavaScript.

## WebKit and native interaction

The application uses AppKit menus and the responder chain for Cut, Copy, Paste, and Select All. Undo and Redo stay with the Web composer so native key equivalents cannot bypass its transaction state. Find uses `WKWebView.find`; reload and page zoom use WebKit APIs without product-DOM scripting.

HTML file inputs are adapted through `WKOpenPanelParameters` and an application-owned `NSOpenPanel`. Same-origin session export uses `WKDownload` and `NSSavePanel`. Cancelled choices write nothing. Redirects, authentication challenges, and downloads outside the allowed export endpoint fail closed.

Camera and microphone requests are denied. External links open in the system browser. The startup, loading, failure, and retry view is native AppKit and exists before the WebView is attached.

If the Web content process terminates, the app consumes one automatic recovery attempt. Further failure shows a native diagnostic and Retry action. Attach mode retries the same validated origin; owner mode can replace only its own exited Host.

## Security model

The application accepts top-level navigation only to the exact attached loopback origin. Another scheme, hostname, or local port is not equivalent. Subframes are limited to that origin and inert `about:blank` documents. File URLs, arbitrary new WebKit windows, remote frames, and TLS challenges are rejected or opened externally as appropriate.

There is no `WKScriptMessageHandler` that exposes shell commands, filesystem operations, approvals, tokens, or arbitrary native methods. Web UI actions reach the existing Host APIs, so DSH capability providers and permission plugins remain the enforcement point.

Navigation isolation does not authenticate the client to the Host. Another process running as the same user may be able to reach an unauthenticated loopback endpoint. Authenticated local transport is a distribution-hardening requirement, not a property of the current development build.

## Artifacts and platform support

The development build compiles the SwiftPM executable, generates the icon and monochrome startup glyph from the official Harness glyph, and assembles a conventional application bundle at `dist/DeepSeek Harness Desktop.app`. The consumer build additionally stages a closed production dependency graph and a checksum-verified official Node.js runtime under `Contents/Resources/runtime`. Generated resources and build output are not source-controlled.

Runtime staging operates on an isolated clone of the selected Harness revision and never modifies that checkout. It materializes package links, removes package-manager machine state, strips native debug paths, and rejects missing CLI/Web entries. Release smoke then runs the Host with isolated user state and launches a relocated copy of the application without development overrides.

## Evolution model

This design supports incremental native replacement. A future native screen can call a typed Host API while the remaining screens continue in WebKit. Session and permission ownership does not move merely because presentation changes.

Distribution and authenticated loopback transport can continue to evolve around the existing topology. They do not require a second Host or a new plugin model.

Cross-component interface details and acceptance checks are maintained in [Delivery contracts](delivery-contracts.md).
