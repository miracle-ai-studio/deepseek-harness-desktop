# DeepSeek Harness Desktop

English | [中文](README.zh.md)

A native macOS desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It opens the existing DSH Web Host in a focused AppKit window while the Host continues to own sessions, tools, permissions, approvals, and persistence.

[Product website](https://miracle-ai-studio.github.io/deepseek-harness-desktop/) · [Architecture](docs/architecture.md) · [Delivery contracts](docs/delivery-contracts.md)

## Download

Download the latest DMG from the [Releases page](https://github.com/miracle-ai-studio/deepseek-harness-desktop/releases/latest). The consumer application includes its versioned DeepSeek Harness Host and official Node.js runtime, so it does not require a source checkout, Homebrew Node, or a separate dependency install.

## Run from source

Keep this repository beside a compatible DeepSeek Harness checkout:

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

Build the companion application from this repository:

```sh
cd ../deepseek-harness-desktop
npm run build:app
open "dist/DeepSeek Harness Desktop.app"
```

Opening the app directly selects owner mode: it locates the sibling Harness checkout, starts its existing `web` profile, and owns only that child Host.

To assemble the same self-contained consumer application used for releases:

```sh
npm run build:release
npm run smoke:runtime
npm run smoke:release
```

## Attach to an existing profile

Build the plugin, install the local package into a DSH `web` profile, then give the profile the path to the companion app:

```sh
cd ../deepseek-harness-desktop
npm run build:plugin

cd ../deepseek-harness
pnpm dsh plugin --profile web add "file:../deepseek-harness-desktop/packages/cordis-plugin"

DSH_DESKTOP_APP_PATH="$(cd ../deepseek-harness-desktop && pwd)/dist/DeepSeek Harness Desktop.app" \
  pnpm dsh --profile web
```

The profile starts the existing Host first. After Loader settlement, the plugin attaches the native window to its assigned loopback URL. Closing the attached application never terminates that Host.

## Architecture

The project ships two separate artifacts:

- `@deepseek-ai/dsh-macos-surface` is a standard Cordis plugin and `dsh.bundle` profile layer.
- `DeepSeek Harness Desktop.app` is a Swift/AppKit companion application with a restricted `WKWebView`.

Both entry paths preserve one Host as the source of truth. The native layer owns presentation and only processes it started; it does not add a second Agent runtime, session store, approval path, shell bridge, or unrestricted filesystem API.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `applicationPath` | `DSH_DESKTOP_APP_PATH`, then `/Applications/DeepSeek Harness Desktop.app` in the shipped profile | Select the companion app. |
| `launchMode` | `launch-if-needed` | Launch the app; `attach-only` only prints the resolved URL. |
| `launchTimeoutMs` | `30000` | Native launch and owned-process cleanup deadline. |
| `DSH_HARNESS_ROOT` | Sibling `../deepseek-harness` | Select a Harness source checkout for development owner mode. |
| `DSH_NODE_BINARY` | Common Homebrew paths, then `PATH` | Select Node for development owner mode. |

## Development

Run the narrow check for the surface you change, or use the full local gate:

```sh
npm run test:plugin
npm run test:swift
npm run test:integration
npm run build:app
npm run smoke
npm run smoke:native
npm run smoke:assembled
npm run smoke:runtime
npm run smoke:release
npm run check
```

The plugin checks require the sibling Harness checkout. Runtime and integration tooling also accept `DSH_HARNESS_ROOT` when the checkout lives elsewhere.

## Documentation and license

- [Architecture](docs/architecture.md)
- [Delivery contracts](docs/delivery-contracts.md)
- [Contributor instructions](AGENTS.md)

DeepSeek Harness Desktop is available under the [MIT License](LICENSE).
