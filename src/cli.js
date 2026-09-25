#!/usr/bin/env node
import { runProxy } from './proxy.js';
import { bridgeOptions, runBridge } from './bridge.js';
import { runAudit } from './audit.js';
import { applyInstall } from './install.js';
import { applyTrim, planTrim, resetTrim } from './trim.js';
import { buildSummary } from './summary.js';
import { startServer } from './server.js';
import { dataDir } from './paths.js';

const HELP = `headroom: see what your MCP servers cost you and what they're doing.

Usage:
  headroom audit [--json] [server...]   Connect to every configured server and measure its tools
  headroom status [--json]              Context cost, usage and issues from the latest data
  headroom install [--dry-run]          Route stdio servers in Claude, Claude Code, Cursor, VS Code through the proxy
  headroom uninstall                    Put every client config back to direct connections
  headroom trim [--days N] [--apply] [--include-idle] [--reset [server]]
                                        Keep only the tools you used in the last N days (default 7)
  headroom serve [--port 7777]          Dashboard at http://127.0.0.1:7777
  headroom proxy --name NAME -- CMD...  (used by client configs) proxy one stdio server
  headroom bridge --name NAME --url URL [--header "K: V"]
                                        (used by client configs) proxy one remote HTTP server over stdio

Data lives in: ${dataDir()}
`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = f => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const k = n => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
const pct = n => (n * 100).toFixed(0) + '%';
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function printSummary(s) {
  if (!s.servers.length) {
    console.log('No data yet. Run `headroom audit` first.');
    return;
  }
  console.log(`\nContext loaded per turn: ${s.totalTokens.toLocaleString('en-US')} tokens (${pct(s.pctOfWindow)} of ${k(s.contextWindow)}, budget ${s.budgetPct}%)\n`);
  console.log(pad('Server', 22) + lpad('Tools', 8) + lpad('Used 7d', 9) + lpad('Tokens', 10));
  for (const x of s.servers) {
    const tools = x.allowlisted ? `${x.enabledCount}/${x.toolCount}` : x.toolCount;
    console.log(pad(x.name, 22) + lpad(tools, 8) + lpad(s.hasUsageData ? x.usedCount : '-', 9) + lpad(x.tokens.toLocaleString('en-US'), 10));
  }
  if (s.clashes.length) {
    console.log(`\nName clashes (${s.clashes.length}):`);
    for (const c of s.clashes.slice(0, 10)) console.log(`  ${c.tool}: ${c.servers.join(', ')}`);
  }
  const writes = s.servers.flatMap(x => x.writeTools.map(t => `${x.name}.${t}`));
  if (writes.length) console.log(`\nWrite or delete tools loaded: ${writes.length} (e.g. ${writes.slice(0, 4).join(', ')})`);
  if (s.hasUsageData) {
    console.log(`\nToday: ${s.today.calls} tool calls, ${pct(s.today.failedPct)} failed, median ${s.today.medianMs ?? '-'} ms`);
    if (s.trimmableTokens) console.log(`${s.unusedTools} tools unused in 7 days. \`headroom trim --apply\` saves about ${k(s.trimmableTokens)} tokens per turn.`);
    if (s.idleServers.length) console.log(`Not called in 7 days: ${s.idleServers.join(', ')}. Consider removing them from your client config.`);
  } else {
    console.log('\nNo usage data yet. Run `headroom install` so calls go through the proxy.');
  }
  console.log('');
}

async function main() {
  switch (cmd) {
    case 'proxy': {
      const sep = argv.indexOf('--');
      const name = opt('--name');
      if (!name || sep < 0 || !argv[sep + 1]) {
        console.error('usage: headroom proxy --name NAME -- COMMAND [ARGS...]');
        process.exit(2);
      }
      runProxy({ name, command: argv[sep + 1], args: argv.slice(sep + 2) });
      return;
    }
    case 'bridge': {
      const name = opt('--name');
      const { url, headers } = bridgeOptions(argv.slice(1));
      if (!name || !url) {
        console.error('usage: headroom bridge --name NAME --url URL [--header "Name: value"]');
        process.exit(2);
      }
      runBridge({ name, url, headers });
      return;
    }
    case 'audit': {
      const only = argv.slice(1).filter(a => !a.startsWith('--'));
      const results = await runAudit({ only: only.length ? only : undefined, onProgress: n => !flag('--json') && process.stderr.write(`checking ${n}...\n`) });
      const summary = buildSummary();
      if (flag('--json')) return console.log(JSON.stringify({ results, summary }, null, 2));
      if (!results.length) return console.log('No MCP servers found in Claude Desktop, Claude Code, Cursor or VS Code configs.');
      for (const r of results.filter(r => !r.ok)) console.log(`! ${r.name}: ${r.error}`);
      printSummary(summary);
      return;
    }
    case 'status': {
      const s = buildSummary();
      return flag('--json') ? console.log(JSON.stringify(s, null, 2)) : printSummary(s);
    }
    case 'install':
    case 'uninstall': {
      const report = applyInstall({ undo: cmd === 'uninstall', dryRun: flag('--dry-run') });
      if (!report.length) console.log('No client configs found.');
      for (const r of report) {
        if (r.error) console.log(`${r.client}: ${r.error}`);
        else if (r.readOnly) console.log(`${r.client}: not proxied, ${r.reason}: ${r.readOnly.join(', ')}`);
        else {
          console.log(`${r.client}: ${r.changed.length ? (cmd === 'install' ? 'proxied ' : 'restored ') + r.changed.join(', ') : 'nothing to change'}${r.backup ? `\n  backup: ${r.backup}` : ''}`);
          for (const x of r.skipped || []) console.log(`  not proxied: ${x.name}, ${x.reason}`);
        }
      }
      if (cmd === 'install' && !flag('--dry-run')) console.log('\nRestart your MCP clients so they pick up the change.');
      return;
    }
    case 'trim': {
      if (flag('--reset')) {
        const server = argv[argv.indexOf('--reset') + 1];
        resetTrim(server && !server.startsWith('--') ? server : undefined);
        return console.log('Allow-list cleared. All tools are back on.');
      }
      const days = Number(opt('--days', 7));
      const includeIdle = flag('--include-idle');
      const plan = flag('--apply') ? applyTrim({ days, includeIdle }) : planTrim({ days, includeIdle });
      for (const c of plan.changes) {
        console.log(c.action === 'trim' ? `${c.server}: keep ${c.keep} of ${c.of} tools, saves ${k(c.savedTokens)} tokens` : `${c.server}: skipped (${c.reason})`);
      }
      console.log(`\nTotal saving: about ${k(plan.savedTokens)} tokens per turn.`);
      console.log(flag('--apply') ? 'Applied. Restart your MCP clients to reload tool lists.' : 'Dry run. Add --apply to turn the unused tools off.');
      return;
    }
    case 'serve': {
      const port = Number(opt('--port', process.env.HEADROOM_PORT || 7777));
      await startServer({ port });
      console.log(`Headroom dashboard: http://127.0.0.1:${port}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
