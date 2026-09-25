# Headroom

## Waiting on Kugen

- **M2 real-world check needs at least one local MCP server.** This Mac has none: the Figma, Claude Docs and Google Drive tools are claude.ai connectors and never touch a local config. Add one or two servers you will actually use, for example in Terminal:
  `claude mcp add --scope user filesystem -- npx -y @modelcontextprotocol/server-filesystem ~/Documents`
  and/or add the same entry to Claude Desktop (Settings, Developer, Edit config). Then tell Claude "servers added". Claude runs `headroom install`; you restart Claude Desktop and Claude Code, use a tool or two, and run `/context` in Claude Code so the token numbers can be compared.

- **M5 Lemon Squeezy store and product.** Licensing is built and tested against a fake server; it only needs your ids.
  1. At app.lemonsqueezy.com create the store (Settings, Stores) and note its numeric **store id**.
  2. Create a product "Headroom" with one variant, single payment, price of your choice. Under the variant turn on **Generate license keys**, activation limit as you like (2 or 3 Macs is common), license length **Unlimited** (updates are limited to 12 months by the app, not by the key).
  3. Note the numeric **product id** (and variant id), and the product's checkout URL.
  4. Tell Claude those three values. They are public ids, not secrets. Never paste an API key into chat; the licence API does not need one.

- **M6 Sparkle signing key.** The private key must be created in your own Keychain. In Terminal, from the repo:
  `cd ~/Documents/headroom/mac && swift package resolve && .build/artifacts/sparkle/Sparkle/bin/generate_keys`
  It prints a public key (a line of base64). That one is public: paste it to Claude, or put it in `mac/Info.plist` under `SUPublicEDKey`. Keep the private key in the Keychain; back it up with `generate_keys -x ~/sparkle-private-key` somewhere safe (a password manager), because losing it means existing installs can never update.
- **M7 Developer ID certificate.** None is installed on this Mac. In Xcode: Settings, Accounts, your Apple Developer team, Manage Certificates, +, Developer ID Application. Then `security find-identity -v -p codesigning` should list it.
- **M7 notarization credentials.** In Terminal (not chat): create an app-specific password at account.apple.com, then `xcrun notarytool store-credentials headroom --apple-id kugenesh@gmail.com --team-id YOURTEAMID` and paste the password when it asks.
- **M6 where updates are hosted.** This repo is private, so its Releases cannot be downloaded by customers. Proposed: a public repo `kugensegaran/headroom-releases` with GitHub Pages serving `appcast.xml` and each DMG attached to a Release there (already set as `SUFeedURL` in `mac/Info.plist`). Say yes and Claude creates it, or name another host.

A macOS menu bar app that shows what MCP servers cost in context tokens and what they are doing, live. One-time purchase, local only. Owner: Kugen Segaran.

## How it fits together

```
Claude / Claude Code / Cursor / VS Code
        │  (config rewritten by `headroom install`)
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
  - `server.js` localhost API; POSTs need header `x-headroom: 1`; Host must be 127.0.0.1 or localhost
  - `dashboard.html` the dashboard window, no build step
- `mac/` Swift package (macOS 14+). `Engine.swift` process + API client, `PopoverView.swift` UI.
- Data dir: `~/Library/Application Support/Headroom` (override with `HEADROOM_HOME`).

## Commands

- Engine tests: `npm test` (must stay green)
- Try the engine: `node src/cli.js audit`, `node src/cli.js status`, `node src/cli.js serve`
- Build the app: `scripts/build-app.sh --run` (engine tests, `swift build`, assemble `build/Headroom.app`, ad-hoc sign, open)
- Swift only: `cd mac && swift build`
- Run the app against the repo engine without rebuilding it: `HEADROOM_ENGINE=$PWD mac/.build/debug/Headroom`

## Rules

- Authorship: every commit and PR is Kugen Segaran <kugenesh@gmail.com> only. Never add Co-Authored-By, "Generated with Claude Code", session links or any AI credit to commits, PRs, release notes, the app's About box or the website. `.claude/settings.json` turns attribution off and `.githooks/commit-msg` strips it as a backstop.
- The Swift code was written without a compiler. First job on a Mac: build it and fix whatever fails.
- Design source of truth: Figma file at https://www.figma.com/design/d1szuOdW0BqvA9Sb8FXPMr (made under the working name "MCP Meter"; the product is now Headroom). Native macOS look: SF Pro, system colors, frosted materials, small controls. No custom fonts, no gradients in UI.
- Never send tool call content off the machine. No analytics, no network calls except audits the user starts.
- `install` must stay reversible: back up before writing, `uninstall` unwraps in place.
- UI and docs copy: sentence case, plain and direct, no em dashes.
- Keep the engine dependency-free beyond js-tiktoken unless there is a strong reason.

## Status

- 2026-09-25: engine done and tested against real servers (filesystem, memory, playwright). Swift app builds and runs on this Mac (full Xcode selected, no SDK fallback). Renamed from MCP Meter to Headroom.

## Roadmap to v1.0 (development complete)

Work top to bottom. Tick each box in this file when it is done, tested and committed. Items marked STOP need Kugen: explain exactly what he must do, then move on to the next item that does not depend on it.

### M1 Build hygiene
- [x] Full Xcode selected (`xcode-select -p` points into Xcode.app). STOP if not: ask Kugen to run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- [x] Remove the SDK fallback from scripts/build-app.sh; `swift build` clean with zero warnings.
- [x] `git config core.hooksPath .githooks` runs from build-app.sh so fresh clones keep the authorship hook.

### M2 Real-world check on this Mac
- [x] `node src/cli.js audit` against Kugen's real configs; fix every server that fails for a reason on our side. (2026-09-25: no local servers configured on this Mac, only claude.ai connectors, which run remotely and are out of Headroom's reach. Fixed the contradictory empty-audit message.)
- [ ] WAITING `node src/cli.js install`; ask Kugen to restart Claude Desktop and Claude Code and use tools; confirm calls appear in the dashboard and popover.
- [ ] WAITING Sanity-check token estimates: compare one server's total against the client's own context readout (Claude Code `/context`). Note the gap in docs/ACCURACY.md.

### M3 Engine completeness
- [x] Claude Code plugin servers: `.mcp.json` inside enabled plugins (`~/.claude/plugins`, `enabledPlugins` in `~/.claude/settings.json`). Audit them; install cannot rewrite plugin files, so show them as not proxied with a reason. Tests.
- [x] Claude Code project servers: `~/.claude.json` `projects[*].mcpServers` and `.mcp.json` files in recent projects. Tests.
- [x] VS Code `inputs`/`${input:...}` values handled without leaking secrets into logs. Tests.
- [x] Remote HTTP servers: `headroom bridge --name X --url U [--header K:V]` stdio-to-streamable-HTTP bridge, logged like stdio. `install` wraps url servers through it when the client supports stdio; OAuth-only servers are skipped with a clear reason. Tests with a local HTTP fake server.
- [x] Event retention: prune event files older than 30 days (setting). Tests.
- [x] `headroom doctor`: checks node path, config paths, wrapped entries pointing at a missing cli.js, and fixes them.

### M4 App completeness
- [x] App icon and menu bar mark: assets in design/icon (see its README), wired into HeadroomApp.swift, Info.plist and build-app.sh. Built and checked in the dark menu bar; it is a template image, so the light menu bar is handled by macOS.
- [x] First-run onboarding window: explain, run audit, show results, offer install with a plain "you can undo this" line.
- [x] Settings window: context window size, budget %, retention days, launch at login (`SMAppService.mainApp`), pause.
- [x] "Restore original configs" menu item (runs uninstall) and a confirmation.
- [x] Notifications (UserNotifications): over budget, server failing repeatedly. Off by default except failures. (Logic done; delivery and the permission prompt still need one manual check, listed in docs/QA.md.)
- [x] About window: name, version, copyright Kugen Segaran. No AI credit.
- [x] Engine lifecycle: restart engine if it dies; stop it on quit; handle port 7777 taken. (Tested: restart after kill, exit on quit and on force quit via --parent-pid, falls back to 7778 when 7777 is taken by something else.)
- [x] Popover and dashboard checked against the Figma frames in light and dark mode. (Figma has light frames only; dark checked for contrast. Added the Clients and Settings dashboard views from the Figma sidebar, friendly client names, failing servers under Needs attention.)

### M5 Licensing (one-time purchase, 12 months of updates)
- [ ] WAITING STOP: Kugen creates the Lemon Squeezy store and product, and gives the store id and product/variant ids (not API secrets in chat). Then set `LicenseConfig.storeID`/`productID` in mac/Sources/Headroom/License.swift and add a Buy button with the checkout URL to LicenseView.
- [x] Licence window: activate, deactivate, show updates-until date. Lemon Squeezy License API (activate/validate), key in Keychain, 14-day full trial, offline grace of 30 days.
- [x] Unlicensed after trial: audit and dashboard still work; proxy logging, trim and notifications need a licence.

### M6 Updates
- [ ] WAITING Sparkle 2 via SwiftPM. STOP: Kugen runs Sparkle's `generate_keys` so the private key stays in his Keychain; public key goes in Info.plist. (Sparkle is integrated, embedded by build-app.sh, and switches itself on once `SUPublicEDKey` is set; "Check for Updates…" appears in the menu then.)
- [ ] WAITING Appcast hosted on GitHub Releases or Pages; updates offered only while the licence's update window is open. (Window filter done and tested in UpdateWindow; hosting waits on Kugen's yes to a public releases repo.)

### M7 Release pipeline
- [ ] WAITING `scripts/release.sh`: bundle node, sign node and app with Developer ID (hardened runtime, JIT entitlements for node), notarize, staple, build DMG, draft GitHub Release. Kugen has an Apple Developer account. (Written; `--adhoc` run verified: bundled node runs under hardened runtime with JIT entitlements, app launches from the DMG build. The notarized run waits on the certificate and credentials.)
- [ ] WAITING STOP: Kugen runs `xcrun notarytool store-credentials headroom ...` himself (app-specific password never goes through chat).
- [ ] WAITING Notarized DMG installs and runs on a clean user account.

### M8 Website
- [ ] `site/`: landing page and free in-browser audit from the Figma design, static, no tracking, no AI credit. Deploy to GitHub Pages.
- [ ] STOP: domain choice and DNS by Kugen.

### M9 QA and docs
- [ ] docs/QA.md checklist run end to end on a clean account; fix what fails.
- [ ] README for users: install, what it changes, how to undo, privacy.

Definition of done: M1 to M9 ticked except items blocked on a STOP, which are listed in a "Waiting on Kugen" section at the top of this file.
