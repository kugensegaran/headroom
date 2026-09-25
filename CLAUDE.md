# MCP Meter

A macOS menu bar app that shows what MCP servers cost in context tokens and what they are doing, live. One-time purchase, local only. Owner: Kugen Segaran.

## How it fits together

```
Claude / Claude Code / Cursor / VS Code
        │  (config rewritten by `mcpmeter install`)
        ▼
node src/cli.js proxy --name X -- <original server command>   ← one per stdio server
        │ logs every call to events-YYYY-MM-DD.jsonl, filters tools/list by allow-list
        ▼
node src/cli.js serve  →  http://127.0.0.1:7777 (dashboard + JSON API + SSE)
        ▲
mac/ SwiftUI MenuBarExtra app: starts `serve`, polls /api/summary, drives trim/pause/audit
```

- `src/` Node engine, plain ES modules, one dependency (js-tiktoken). Node 20+.
  - `proxy.js` stdio pass-through, logging, allow-list enforcement
  - `audit.js` + `mcpclient.js` connect to each configured server and list tools (stdio and streamable HTTP)
  - `clients.js` config file locations per client; `install.js` wrap/unwrap with backups
  - `summary.js` the single data view used by CLI, dashboard and app
  - `trim.js` allow-list from real usage; idle servers are never trimmed
  - `server.js` localhost API; POSTs need header `x-mcpmeter: 1`; Host must be 127.0.0.1 or localhost
  - `dashboard.html` the dashboard window, no build step
- `mac/` Swift package (macOS 14+). `Engine.swift` process + API client, `PopoverView.swift` UI.
- Data dir: `~/Library/Application Support/MCPMeter` (override with `MCPMETER_HOME`).

## Commands

- Engine tests: `npm test` (must stay green)
- Try the engine: `node src/cli.js audit`, `node src/cli.js status`, `node src/cli.js serve`
- Build the app: `scripts/build-app.sh --run` (engine tests, `swift build`, assemble `build/MCP Meter.app`, ad-hoc sign, open)
- Swift only: `cd mac && swift build`
- Run the app against the repo engine without rebuilding it: `MCPMETER_ENGINE=$PWD mac/.build/debug/MCPMeter`

## Rules

- The Swift code was written without a compiler. First job on a Mac: build it and fix whatever fails.
- Design source of truth: Figma file "MCP Meter mockups" (https://www.figma.com/design/d1szuOdW0BqvA9Sb8FXPMr). Native macOS look: SF Pro, system colors, frosted materials, small controls. No custom fonts, no gradients in UI.
- Never send tool call content off the machine. No analytics, no network calls except audits the user starts.
- `install` must stay reversible: back up before writing, `uninstall` unwraps in place.
- UI and docs copy: sentence case, plain and direct, no em dashes.
- Keep the engine dependency-free beyond js-tiktoken unless there is a strong reason.

## Status (2026-09-25)

Done and tested on Linux against real servers (filesystem, memory, playwright MCP): proxy, logging, allow-list, audit, install/uninstall, trim, dashboard with live feed. Swift app written, not yet compiled.

## Next, in order

1. Build the Swift app, fix compile errors, run it, check the popover against the Figma frame.
2. End to end on this Mac: `node src/cli.js install`, restart Claude Desktop and Claude Code, use tools, watch the dashboard.
3. Launch at login (`SMAppService.mainApp`), first-run onboarding (audit, then offer install).
4. Proxy remote HTTP servers (currently audited only; OAuth servers need the client's token so start with a stdio bridge).
5. `--bundle-node` release build, Developer ID signing and notarization (docs/RELEASE.md).
6. Licence keys (Lemon Squeezy or Paddle), 12 months of updates, Sparkle for updates.
7. Marketing page and free web audit (approved design is on the Figma file).
