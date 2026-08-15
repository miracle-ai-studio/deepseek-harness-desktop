# DeepSeek Harness Desktop

English | [中文](README.zh.md)

A native macOS client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Open DSH in a focused AppKit window while keeping sessions, tools, permissions, and persistence in the existing Cordis Host.

[Download for macOS](https://github.com/deepseek-ai/deepseek-harness-desktop/releases/latest/download/DeepSeek-Harness-Desktop.dmg) · [Product website](https://deepseek-ai.github.io/deepseek-harness-desktop/) · [Architecture](docs/architecture.md)

## Install for users

This is the recommended path for using the released application.

1. Install [Node.js](https://nodejs.org/) 22.19 or later.
2. Download DeepSeek Harness Desktop from the product website.
3. Install the desktop plugin into the DSH `web` profile:

```sh
npx @deepseek-ai/dsh plugin --profile web add @deepseek-ai/dsh-macos-surface
```

Start DSH:

```sh
npx @deepseek-ai/dsh --profile web
```

The profile starts the existing DSH Host and opens `/Applications/DeepSeek Harness Desktop.app`. Sessions and permissions remain in DSH; closing the window does not terminate a Host started by the profile.

## Install for developers

Keep the Desktop and Harness repositories beside each other:

```text
workspace/
├── deepseek-harness/
└── deepseek-harness-desktop/
```

Prepare the verified Harness revision:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f943859bef60e4160492346772ded9b24f765a
pnpm install
pnpm run build
```

Build and verify Desktop:

```sh
cd ../deepseek-harness-desktop
npm run check
```

The application is assembled at:

```text
dist/DeepSeek Harness Desktop.app
```

Install the local plugin checkout and launch the profile against that application:

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add "file:../deepseek-harness-desktop/packages/cordis-plugin"

DSH_DESKTOP_APP_PATH="$(cd ../deepseek-harness-desktop && pwd)/dist/DeepSeek Harness Desktop.app" \
  pnpm dsh --profile web
```

Open the development app directly when testing owner mode:

```sh
open "dist/DeepSeek Harness Desktop.app"
```

## How it works

The repository ships two artifacts:

- `@deepseek-ai/dsh-macos-surface` is a standard Cordis plugin and `dsh.bundle` profile layer.
- `DeepSeek Harness Desktop.app` is a Swift/AppKit client that presents the existing Web Client in a restricted `WKWebView`.

Cordis imports the JavaScript plugin, not the `.app`. The plugin waits for the existing Loader and `webServer`, then attaches the native window to the assigned loopback URL. Direct app launch starts and owns the existing Harness `web` profile. Both paths keep one Host as the source of truth.

The Web page receives no native shell bridge. Shell commands, filesystem access, sandboxing, and approvals continue through DSH capability and permission plugins.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `applicationPath` | `DSH_DESKTOP_APP_PATH`, then `/Applications/DeepSeek Harness Desktop.app` in the shipped profile | Select the companion app. |
| `launchMode` | `launch-if-needed` | Launch the app; `attach-only` only publishes the resolved URL. |
| `launchTimeoutMs` | `30000` | Native launch and cleanup deadline. |
| `DSH_HARNESS_ROOT` | Sibling `../deepseek-harness` | Select a Harness source checkout for owner-mode development. |
| `DSH_NODE_BINARY` | Common Homebrew paths, then `PATH` | Select Node for owner-mode development. |

## Development commands

```sh
npm run test:plugin
npm run test:swift
npm run test:integration
npm run build:app
npm run smoke
npm run smoke:native
npm run smoke:assembled
npm run check
```

The current source build produces the build machine's architecture. A public macOS release should provide a verified Universal 2 application. Signing and notarization are optional for source distribution and recommended for a frictionless binary release.

## Documentation and license

- [Architecture](docs/architecture.md)
- [Delivery contracts](docs/delivery-contracts.md)
- [Contributor instructions](AGENTS.md)

DeepSeek Harness Desktop is available under the [MIT License](LICENSE).
