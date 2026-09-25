# MCP Meter

See what your MCP servers cost you before you type a word, and watch every tool call live.

## Quick start (engine only)

```
npm install
node src/cli.js audit        # measure every server in Claude Desktop, Claude Code, Cursor, VS Code
node src/cli.js install      # route stdio servers through the local proxy (backs up configs first)
node src/cli.js serve        # dashboard at http://127.0.0.1:7777
node src/cli.js trim         # dry run: which unused tools to turn off
node src/cli.js uninstall    # put configs back
```

## Mac app

`scripts/build-app.sh --run` builds `build/MCP Meter.app`. See CLAUDE.md for the architecture and roadmap, and docs/RELEASE.md for signing.
