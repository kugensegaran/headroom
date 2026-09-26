# Headroom

Every MCP server, working in every client. See every call.

Headroom is a Mac menu bar app that sits between your apps (Claude Desktop, Claude Code, Cursor, VS Code) and your MCP servers.

- **See every call** as it happens, with latency and status, in the menu bar and a local dashboard.
- **Works in every app.** Compatibility fixes let a server made for one app work in the others, for example by removing schema lines Claude Desktop rejects. Each fix is listed in Settings and can be turned off.
- **Tools per app.** Give each app its own set of tools. On new installs, write and delete tools stay off until you turn them on. VS Code gets a warning and a trimmed profile when it passes its 128-tool limit.
- **Estimated cost per app.** Tool definitions take room in the model's context, but how much depends on the app: Claude Code and Cursor load tools on demand, VS Code sends every tool with each request. Headroom's figures are estimates, calibrated against Claude Code.

## Install

1. Open the Headroom DMG and drag Headroom to Applications.
2. Open Headroom. It lives in the menu bar; there is no Dock icon.
3. The welcome window checks the servers in Claude Desktop, Claude Code, Cursor and VS Code and lists their tools.
4. To see calls live and use the fixes and per-app tools, choose **Route through Headroom**, then restart your MCP clients.

Needs macOS 14 or later. Everything works free for 14 days; after that, audit and the dashboard keep working, and live logging, trim and notifications need a licence.

## What it changes

Checking your servers changes nothing. Routing clients through Headroom does:

- Each local server entry in your client configs is rewritten to start through Headroom's proxy, which passes every message through unchanged and logs the call.
- Remote servers go through Headroom's bridge when they work without a sign-in. Servers that sign in with OAuth are left as they are.
- Shared project files (`.mcp.json` in a repo) and servers that come with Claude Code plugins are never rewritten. They are measured, not proxied.
- Before any config is written, a copy is saved to `~/Library/Application Support/Headroom/backups`.

Tool sets are per app. Trim keeps, for each app, the tools it used in the last 7 days; an app that never called a server keeps all of that server's tools, so a quiet week never breaks anything.

## How to undo

- **Restore Original Configs…** in the menu bar puts every config back to connect directly. Restart your clients afterwards.
- In the dashboard, **Servers**, pick an app and choose **Use default** to undo its tool set for a server.
- The backups folder has the exact files from before each change.
- To remove Headroom completely: restore original configs, quit Headroom, delete it from Applications, and delete `~/Library/Application Support/Headroom`.

If servers stop starting after you move Headroom or update Node, choose **Route Clients Through Headroom** again. It repairs entries that point at the old location.

## Privacy

Headroom has no account, no analytics and no tracking.

- It records which tool was called, when, how long it took, its size and whether it worked. It never records what tools were sent or sent back.
- Call history stays on your Mac and is deleted after 30 days by default (Settings).
- The only network traffic is audits you start (listing tools on your remote servers), licence checks with Lemon Squeezy (your key and an activation id, about once a week), and update checks.

## Command line

The engine inside the app is a small Node program. From a checkout of this repo:

```
npm install
node src/cli.js audit        # measure every configured server
node src/cli.js status       # context cost, usage and issues
node src/cli.js install      # route clients through Headroom (backs up configs first)
node src/cli.js uninstall    # put configs back
node src/cli.js trim         # dry run: which unused tools to turn off (--apply to do it)
node src/cli.js doctor       # check Node, configs and wrapped entries (--fix to repair)
node src/cli.js serve        # dashboard at http://127.0.0.1:7777
```

## Building

`scripts/build-app.sh --run` runs the tests and builds `build/Headroom.app`. `scripts/release.sh` makes a signed, notarized DMG (see docs/RELEASE.md). CLAUDE.md has the architecture and roadmap.

Headroom is made by Kugen Segaran. Not affiliated with Anthropic or the MCP project.
