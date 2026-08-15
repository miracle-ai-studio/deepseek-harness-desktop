# @deepseek-ai/dsh-macos-surface

This package is both the Cordis plugin and the external DeepSeek Harness bundle layer for the macOS client. It depends on the existing `webServer` and Loader; it does not create a Host, session store, tool runtime, or approval path.

Add `@deepseek-ai/dsh-macos-surface` after `@deepseek-ai/dsh-web-app` in a profile's ordered `dsh.profile.bundles` list. The adjacent `cordis.patch.yml` is declared by `dsh.bundle.patch` and inserts the `macos-surface` row.

## Configuration

- `applicationPath`: optional `.app` path. Relative values resolve from the Host working directory. The shipped bundle patch uses `DSH_DESKTOP_APP_PATH`, then `/Applications/DeepSeek Harness Desktop.app`. A raw plugin row that omits the field uses the environment value, then a source-checkout development fallback.
- `launchMode`: `launch-if-needed` starts an owned application process; `attach-only` starts nothing and prints `dsh desktop: <url>` after Loader settlement.
- `launchTimeoutMs`: positive spawn and cleanup deadline, defaulting to 30 seconds.

When `DSH_DESKTOP_APP_OWNS_HOST=1`, activation has no effect. This prevents a directly opened application from recursively launching itself through its child Host.

The plugin validates the application artifact before publishing a launch. Cordis effect cleanup terminates only the exact child returned by this plugin's spawn operation.

## Known limitation

The attachment uses the existing loopback reachability model. It does not authenticate the desktop client; authenticated loopback transport remains required before distribution to untrusted local environments.
