# AGENTS.md

English | [中文](AGENTS.zh.md)

These instructions apply to the entire `deepseek-harness-desktop` repository.

## Product boundary

Read [Architecture](docs/architecture.md) and [Delivery contracts](docs/delivery-contracts.md) before changing behavior. This repository is a macOS client surface and Cordis adapter for an existing DeepSeek Harness checkout. It must not reimplement the Harness Host, agent loop, session store, tool runtime, permission policy, approval flow, credentials, or persistence.

There are two deliverables and one runtime authority:

- `packages/cordis-plugin/` is the JavaScript adapter imported by Cordis and the external DSH bundle package.
- `apps/macos/` is the Swift/AppKit companion application.
- The existing Node/Cordis Host remains authoritative in both attach and owner modes.

An `.app` is never a TypeScript package. Cordis loads the adapter, and the adapter may start the companion executable after the existing Web Host is ready.

## Repository layout

```text
apps/macos/              SwiftPM AppKit/WebKit application
packages/cordis-plugin/  Cordis plugin and canonical dsh.bundle patch
scripts/                 build, assembly, and smoke tooling
tests/plugin/            focused TypeScript lifecycle tests
tests/integration/       artifact and cross-component checks
tests/swift/             Swift test entry-point documentation
docs/                    architecture and delivery interfaces
bundle/                  pointer to the canonical package patch
```

Do not copy the patch into a second package. `packages/cordis-plugin/cordis.patch.yml` is the only bundle layer and is referenced by the `patch` field inside `package.json`'s `dsh.bundle` manifest.

## Change rules

- Do not modify the sibling `deepseek-harness` checkout. It is an external development dependency and runtime authority.
- Preserve ESM, strict TypeScript, and explicit package imports. Do not add a CommonJS compatibility path.
- Treat Cordis registrations as effects. Every resource owned by a plugin must have a disposer.
- Keep process ownership explicit. A component may terminate only a process handle that it started; attach mode never terminates the Host.
- Do not add a general JavaScript message handler, native shell bridge, native approval path, or unrestricted filesystem API to `WKWebView`.
- Restrict navigation and downloads to the validated attached origin. Permission-sensitive work remains in Harness capability and policy plugins.
- Build the macOS app with Swift Package Manager and Command Line Tools. Do not require a generated Xcode project for development checks.
- Keep deployment-varying settings in validated plugin configuration or documented environment variables. Fail loudly for missing artifacts and invalid URLs.
- Preserve unrelated working-tree changes. Never use destructive Git cleanup commands to repair generated output.

Cross-component changes to arguments, readiness lines, environment variables, lifecycle ownership, output locations, or security behavior must update `docs/delivery-contracts.md` before dependent implementations change.

## Generated and local files

Do not commit build output or machine state. In particular, keep Swift `.build/`, JavaScript `lib/`, `dist/`, generated `AppIcon.icns`, generated `DeepSeekGlyph.svg`, environment files, logs, editor state, and `.DS_Store` ignored.

Do commit source files under `scripts/lib/`; they are build tooling, not emitted package output. A broad `lib/` ignore rule is therefore forbidden.

The app icon and monochrome startup glyph are generated from the official glyph in the sibling Harness checkout. Do not create a divergent checked-in logo copy.

## Documentation

Public entry documents are paired:

- `README.md` and `README.zh.md`
- `AGENTS.md` and `AGENTS.zh.md`
- `docs/architecture.md` and `docs/architecture.zh.md`

Keep paired headings, lists, tables, examples, and links structurally aligned. English source files use English links; Chinese files use Chinese counterparts when one exists. Write current behavior, give each fact one authoritative home, and link instead of duplicating implementation detail.

Update the affected README and architecture or delivery interface in the same change as product-visible behavior. Do not claim signing, notarization, Universal 2 support, publication, embedded runtime, or authenticated transport until verified artifacts exist.

## Verification

Use the narrowest checks that cover the changed surface:

```sh
npm run test:plugin       # Cordis config and lifecycle
npm run test:swift        # native parsing, security, and ownership logic
npm run test:integration  # build scripts and cross-component interfaces
npm run build:app         # release .app assembly
npm run smoke             # keyless assembled artifact checks
npm run smoke:native      # native source and binary interface checks
npm run smoke:assembled   # explicit real Host/app ownership check
npm run check             # complete default local gate
```

The current TypeScript build and plugin-test configuration requires the sibling `../deepseek-harness` checkout; runtime and integration tools also accept `DSH_HARNESS_ROOT`. Report only checks actually run. A source check does not prove a signed, notarized, Universal, or end-user-distributed artifact.
