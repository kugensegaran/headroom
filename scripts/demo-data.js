#!/usr/bin/env node
// Fill a data folder with the demo numbers from the Figma frames, for screenshots and QA.
//   HEADROOM_HOME=/tmp/headroom-demo node scripts/demo-data.js
//   HEADROOM_HOME=/tmp/headroom-demo node src/cli.js serve --port 7790
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.HEADROOM_HOME) {
  console.error('Set HEADROOM_HOME to a scratch folder first, so your real data is never touched.');
  process.exit(2);
}
const { saveCatalog, appendEvent, setSettings } = await import('../src/store.js');
const { toolTokens } = await import('../src/tokens.js');
const { paths } = await import('../src/paths.js');

const servers = [
  { name: 'GitHub', tokens: 26000, tools: ['list_pull_requests', 'create_issue', 'get_file_contents', 'search_code', 'search', 'get_pull_request'], total: 35 },
  { name: 'Slack', tokens: 21000, tools: ['post_message', 'list_channels', 'search'], total: 11 },
  { name: 'Notion', tokens: 5200, tools: ['query_database', 'search', 'get_page', 'update_page'], total: 19 },
  { name: 'Playwright', tokens: 3400, tools: ['browser_navigate', 'browser_click'], total: 21 },
  { name: 'Linear', tokens: 1900, tools: ['search_issues', 'update_issue', 'get_issue', 'create_comment', 'list_teams'], total: 14 },
  { name: 'Filesystem', tokens: 900, tools: ['read_file', 'list_directory', 'write_file', 'search_files', 'get_file_info', 'move_file', 'create_directory', 'read_multiple_files', 'directory_tree'], total: 11 },
];
const filler = 'Returns the matching records for the given filters, with paging and field selection. ';

for (const dir of [paths.events(), paths.catalog()]) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
setSettings({ paused: false, contextWindow: 200000, budgetPct: 20 });

for (const s of servers) {
  const names = [...s.tools];
  for (let i = names.length; i < s.total; i++) names.push(`${s.name.toLowerCase()}_tool_${i + 1}`);
  const per = s.tokens / s.total;
  const tools = names.map(name => {
    const t = { name, description: '', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } };
    while (toolTokens(t) < per) t.description += filler;
    return t;
  });
  saveCatalog(s.name, tools, { source: 'demo' });
}

// Today's traffic, 08:00 to now, rising through the day; Slack failing for the last 30 minutes.
const clients = ['claude-ai', 'claude-code', 'cursor'];
const now = new Date();
const start = new Date(now);
start.setHours(8, 0, 0, 0);
let n = 0;
for (let ts = start.getTime(); ts < now.getTime(); ts += 20000 + ((n * 7919) % 25000)) {
  const hour = new Date(ts).getHours();
  if ((n * 31) % 100 > 40 + hour * 3) {
    n++;
    continue;
  }
  const s = servers[(n * 13) % servers.length];
  const tool = s.tools[Math.floor(n / servers.length) % s.tools.length];
  const slackDown = s.name === 'Slack' && ts > now.getTime() - 30 * 60000;
  appendEvent({ ts, server: s.name, client: clients[n % 3], method: 'tools/call', tool, ms: s.name === 'Filesystem' ? 5 : 90 + ((n * 37) % 900), reqBytes: 200, resBytes: 800 + ((n * 97) % 20000), status: slackDown ? 'error' : 'ok', write: /create|update|post|write|move/.test(tool) });
  n++;
}
console.log(`Demo data written to ${process.env.HEADROOM_HOME}`);
