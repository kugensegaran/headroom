# Token estimate accuracy

Headroom counts a tool's cost by tokenizing its definition (name, description, input schema) with `cl100k_base`, because Claude's tokenizer is not public. This page records how far that is from what a client actually reports.

## Check of 2026-09-26: Claude Code `/context`

Claude Code (Opus 5.5) with the filesystem and memory reference servers routed through Headroom. Per-tool numbers from `/context`, compared with Headroom's catalog for the same tool lists.

| Server | Tools | Headroom | Claude Code | Ratio |
| --- | ---: | ---: | ---: | ---: |
| filesystem | 14 | 1,649 | 3,116 | 1.89 |
| memory | 9 | 876 | 1,619 | 1.85 |

Every single tool came out between 1.7 and 2.1 times Headroom's figure (smallest: memory `read_graph`, 40 vs 70; largest gap: filesystem `read_text_file`, 184 vs 324). So the gap is steady, not a few odd tools.

Likely causes, in order of size:
1. Claude's tokenizer produces more tokens than `cl100k_base` for JSON schemas and English descriptions.
2. The client adds its own wrapping per tool (the `mcp__server__` name prefix and tool framing).

**What this means today:** Headroom's numbers are roughly half of what Claude counts. Relative sizes (which server is heaviest, what a trim saves in proportion) are right; absolute numbers and the budget percentage are low by about 45%.

**Proposed fix (not applied yet, needs Kugen's call):** multiply tool token estimates by a calibration factor of 1.87 for Claude clients, shown in the UI as "estimated", and re-check against `/context` when Claude models change.

## Claude Code loads MCP tools on demand

The same `/context` shows "MCP tools: 2.6k tokens" loaded and "MCP tools (deferred): 39.9k tokens". Claude Code now keeps most MCP tool definitions out of the prompt until the model searches for them. So in Claude Code, a server's full definition cost is not paid on every turn; in Claude Desktop, Cursor and VS Code it still is.

Headroom currently shows the full cost for every client. Worth deciding whether the popover should say "up to" for Claude Code, or show Claude Code separately.

## How to repeat this check

1. Route Claude Code through Headroom and restart it.
2. Run `/context` and copy the per-tool MCP table.
3. Compare with `~/Library/Application Support/Headroom/catalog/<server>.json` (tokens per tool via `src/tokens.js`), and add a row above.
