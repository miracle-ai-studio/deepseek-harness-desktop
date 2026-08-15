# Dual-entry macOS surface

## Decision

Ship one native macOS client with a JavaScript Cordis adapter. The client supports attach mode when Cordis already owns the Host and owner mode when the user opens the application directly.

The existing Harness Web Host remains authoritative for sessions, tools, approval policy, and persistence. The native client owns macOS windows, WebKit navigation policy, and only the child process it starts.

## Interfaces

Cordis starts the native executable with an exact loopback URL. The shipped profile resolves the app from `DSH_DESKTOP_APP_PATH`, then the standard `/Applications/DeepSeek Harness Desktop.app` location. Direct application startup launches the existing `web` profile on an OS-assigned port and waits for the Web bundle's declared readiness line. An ownership environment marker prevents recursive application launch when the child Host loads the desktop plugin.

## Consequences

Cordis continues to load an ESM package instead of attempting to import an application bundle. The same `.app` remains double-clickable. Future native views can replace Web views incrementally without moving agent or permission authority out of the Host.

The development artifact does not establish local-client authentication. Distribution to untrusted local environments requires an authenticated loopback protocol or equivalent local transport. Developer ID signing and notarization improve binary identity and Gatekeeper installation behavior without changing the runtime topology.
