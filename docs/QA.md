# QA checklist

Run on a clean macOS user account with the notarized DMG. Tick each line; anything that fails becomes an issue before release.

## Install and first run
- [ ] DMG opens, drag to Applications, app opens without a Gatekeeper warning.
- [ ] Welcome window appears on first launch only.
- [ ] "Check my servers" lists every server in Claude Desktop, Claude Code, Cursor and VS Code, with tool counts and tokens.
- [ ] "Route through Headroom" shows what changed and where the backups are.

## Menu bar
- [ ] Mark is visible and readable in both light and dark menu bars; the fill rises with context share.
- [ ] Popover matches the Figma frame in light and dark mode.
- [ ] Pause Proxy stops new calls appearing; Resume Proxy brings them back.
- [ ] Restore Original Configs asks first, then puts every config back exactly (compare with the backup).

## Notifications
- [ ] The first notification asks for permission once.
- [ ] A server failing 3 or more times in 15 minutes posts one notification, then stays quiet for an hour.
- [ ] Over budget notification only when turned on in Settings, and only when crossing the budget.

## Settings
- [ ] Every setting survives quitting and reopening the app.
- [ ] Open at login works after a restart of the Mac.

## Engine
- [ ] Quitting the app stops the engine (`pgrep -fl "cli.js serve"` shows nothing).
- [ ] With something else on port 7777, the app still works on 7778.
- [ ] `headroom doctor` reports no errors after install.

## Launch helpers
Open a window directly for screenshots: `open Headroom.app --args -show settings` (or `onboarding`, `about`, `popover`). Add `-appearance light` or `-appearance dark` to force a mode. `scripts/demo-data.js` fills a scratch data folder with the Figma demo numbers.
