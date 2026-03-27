# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-03-27

### Added

- **Workspace Content Server** — Each workspace now automatically spins up a local HTTP server on a dynamic port. By default, static files are served from the `public/` directory within the workspace root, making it easy to serve HTML, CSS, JS, and other assets directly from your project.

- **Dynamic Routes (opt-in)** — Execute arbitrary JavaScript route handlers from `routes/`, `.routes/`, or `api/` directories within the workspace. Opt in by setting the environment variable `OBOTO_DYNAMIC_ROUTES=true` or by adding `{"dynamicRoutes": {"enabled": true}}` to a `.oboto.json` file at the workspace root. All server requests and errors are logged to `server.log` in the workspace root.

- **Surface Sandboxing & Network Restrictions** — UI Surfaces now run inside a strict sandbox by default. The `fetch` API is intercepted and restricted to `localhost` to prevent data exfiltration. Surfaces should use `surfaceApi.fetchRoute('/path')` to access workspace content-server routes. Users can relax restrictions by setting `surface.sandboxMode` to `"permissive"` in `.oboto.json`.

- **Skill Promotion** — New `promoteSkill(name)` CLI command / tool to promote a workspace-specific skill to the global skills directory, making it reusable across all workspaces.

- **Chronological UI Rendering** — The chat UI now renders tool calls interleaved with text in the exact order they were streamed by the model, improving readability of long reasoning chains and multi-step agent interactions.

- **Conversation Autosave** — Chat history is now automatically saved on every turn with robust file-lock mechanisms to prevent data corruption during concurrent writes.

### Improved

- **Agent Loop Reliability** — "Doom loop" detection now counts loop iterations rather than individual batched tool calls, significantly reducing false positives when the agent legitimately executes many tools in a single turn.

- **Cancelled Request Handling** — Orphaned tool-use blocks from cancelled requests are now automatically patched before the next API call, preventing Anthropic API 400 errors caused by malformed message sequences.

### Configuration

- **`.oboto.json`** — New per-workspace configuration file supporting:
  - `dynamicRoutes.enabled` — Enable dynamic route execution (default: `false`)
  - `surface.sandboxMode` — `"strict"` (default) or `"permissive"` to control surface network access

## [1.2.1] — Previous Release

- Maintenance and bug-fix release (see git history for details).

## [1.2.0] — Previous Release

- Initial public release with multi-agent architecture, generative UI surfaces, plugin ecosystem, Chrome extension, system tray app, and library API.
