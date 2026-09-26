import fs from 'node:fs';
import { getAllowlist, getSettings, readCatalogs, readEvents } from './store.js';
import { isWriteTool, toolTokens } from './tokens.js';
import { clientLabel, discoverServers, knownClients } from './clients.js';
import { LOADING, contextWindows } from './profiles.js';
import { toolAllowed } from './allowlist.js';
import { FIXES, fixList } from './compat.js';
import { licenseState } from './license.js';

/**
 * One view of the world for the CLI, the dashboard and the menu bar app:
 * per-server context cost, usage, clashes and traffic stats.
 */
export function buildSummary({ days = 7 } = {}) {
  const settings = getSettings();
  const allow = getAllowlist();
  const catalogs = readCatalogs();
  const events = readEvents({ days });
  const today = readEvents({ days: 1 });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayEvents = today.filter(e => e.ts >= dayStart.getTime());

  const usedBy = {};
  for (const e of events) {
    if (e.method !== 'tools/call' || !e.tool) continue;
    (usedBy[e.server] ||= new Set()).add(e.tool);
  }

  const toolOwners = {};
  const servers = catalogs.map(c => {
    const tools = c.tools.map(t => ({
      name: t.name,
      tokens: toolTokens(t),
      write: isWriteTool(t.name),
      used: usedBy[c.server]?.has(t.name) || false,
      // As a client without its own list sees it; per-client views are in perClient.
      enabled: toolAllowed({ allow, settings, server: c.server, client: '*', tool: t.name }),
    }));
    for (const t of tools) (toolOwners[t.name] ||= []).push(c.server);
    const enabled = tools.filter(t => t.enabled);
    return {
      name: c.server,
      updated: c.updated,
      toolCount: tools.length,
      enabledCount: enabled.length,
      usedCount: tools.filter(t => t.used).length,
      tokensAll: tools.reduce((s, t) => s + t.tokens, 0),
      tokens: enabled.reduce((s, t) => s + t.tokens, 0),
      // Only servers with some usage are trimmed, so a quiet server never gets switched off by accident.
      trimmable: tools.some(t => t.used) ? tools.filter(t => t.enabled && !t.used).reduce((s, t) => s + t.tokens, 0) : 0,
      idle: !tools.some(t => t.used),
      writeTools: tools.filter(t => t.write).map(t => t.name),
      allowlisted: !!allow[c.server],
      tools,
    };
  });
  servers.sort((a, b) => b.tokens - a.tokens);

  const clashes = Object.entries(toolOwners)
    .filter(([, owners]) => owners.length > 1)
    .map(([tool, owners]) => ({ tool, servers: owners }));

  const calls = todayEvents.filter(e => e.method === 'tools/call');
  const latencies = calls.filter(e => e.status === 'ok').map(e => e.ms).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  const failed = calls.filter(e => e.status === 'error').length;
  const totalTokens = servers.reduce((s, x) => s + x.tokens, 0);
  const perClient = clientCosts(servers, settings, allow);
  // The headline percentage only counts clients that may send every definition every turn.
  const heaviest = perClient.filter(c => c.loading !== 'on-demand').sort((a, b) => b.pctOfWindow - a.pctOfWindow)[0] || null;
  const hours = new Array(24).fill(0);
  for (const e of calls) hours[new Date(e.ts).getHours()]++;

  const slowest = {};
  for (const e of calls) {
    const s = (slowest[e.server] ||= { total: 0, n: 0 });
    s.total += e.ms;
    s.n++;
  }
  const slowestServer = Object.entries(slowest).sort((a, b) => b[1].total / b[1].n - a[1].total / a[1].n)[0]?.[0] || null;

  // Servers failing repeatedly in the last 15 minutes: at least 3 failed calls and at least half of all calls.
  const recent = calls.filter(e => e.ts >= Date.now() - 15 * 60000);
  const byServer = {};
  for (const e of recent) {
    const s = (byServer[e.server] ||= { server: e.server, failed: 0, total: 0 });
    s.total++;
    if (e.status === 'error') s.failed++;
  }
  const failing = Object.values(byServer).filter(s => s.failed >= 3 && s.failed / s.total >= 0.5);

  return {
    generated: Date.now(),
    notifyOverBudget: settings.notifyOverBudget,
    notifyFailures: settings.notifyFailures,
    retentionDays: settings.retentionDays,
    failing,
    compat: fixList(settings),
    writeToolsOff: settings.writeToolsOff,
    fixes: compatNotes(events),
    license: licenseState(),
    paused: settings.paused,
    contextWindow: heaviest ? heaviest.window : settings.contextWindow,
    estimated: true,
    perClient,
    headlineClient: heaviest ? heaviest.label : null,
    budgetPct: settings.budgetPct,
    totalTokens,
    pctOfWindow: heaviest ? heaviest.pctOfWindow : 0,
    unusedTools: servers.filter(x => !x.idle).reduce((s, x) => s + (x.enabledCount - x.usedCount), 0),
    idleServers: servers.filter(x => x.idle).map(x => x.name),
    trimmableTokens: servers.reduce((s, x) => s + x.trimmable, 0),
    clients: [...new Set(todayEvents.map(e => clientLabel(e.client)))],
    today: {
      calls: calls.length,
      failedPct: calls.length ? failed / calls.length : 0,
      failed,
      medianMs: median,
      slowestServer,
      perHour: hours,
    },
    servers,
    clashes,
    hasUsageData: events.some(e => e.method === 'tools/call'),
  };
}

let discovered = { key: null, value: [] };
/** Re-read client configs only when one of them changed; the app polls the summary every 3 seconds. */
function cachedDiscover() {
  const key = knownClients().map(c => {
    try {
      return fs.statSync(c.file).mtimeMs;
    } catch {
      return 0;
    }
  }).join('|');
  if (key !== discovered.key) discovered = { key, value: discoverServers() };
  return discovered.value;
}

let windows = { at: 0, key: null, value: null };
function cachedWindows(settingsWindow) {
  if (!windows.value || windows.key !== settingsWindow || Date.now() - windows.at > 60000) windows = { at: Date.now(), key: settingsWindow, value: contextWindows(settingsWindow) };
  return windows.value;
}

/** What each client's configured servers cost, and how that client loads them. */
function clientCosts(servers, settings, allow) {
  const byClient = {};
  for (const s of cachedDiscover()) (byClient[s.client] ||= new Set()).add(s.name);
  const wins = cachedWindows(settings.contextWindow);
  const labels = Object.fromEntries(knownClients().map(c => [c.id, c.label]));
  return Object.entries(byClient).map(([id, names]) => {
    const list = servers.filter(x => names.has(x.name));
    const on = list.flatMap(x => x.tools.filter(t => toolAllowed({ allow, settings, server: x.name, client: id, tool: t.name })));
    const tokens = on.reduce((n, t) => n + t.tokens, 0);
    const toolCount = on.length;
    const profile = LOADING[id] || { loading: 'unverified', source: 'Not checked yet' };
    const win = wins[id] || { window: settings.contextWindow, source: 'Settings' };
    return {
      id,
      label: labels[id] || id,
      loading: profile.loading,
      loadingSource: profile.source,
      limit: profile.limit || null,
      overLimit: profile.limit ? toolCount > profile.limit : false,
      servers: [...names],
      measured: list.map(x => x.name),
      toolCount,
      tokens,
      window: win.window,
      windowSource: win.source,
      pctOfWindow: tokens / win.window,
    };
  });
}

/** One line per fix for the dashboard: its latest count per server in the period, added up. */
function compatNotes(events) {
  const latest = {};
  for (const e of events) if (e.method === 'compat') latest[`${e.fix}\u0000${e.server}`] = e;
  const byFix = {};
  for (const e of Object.values(latest)) (byFix[e.fix] ||= []).push(e);
  return Object.entries(byFix).map(([id, list]) => {
    const fix = FIXES.find(f => f.id === id);
    const count = list.reduce((n, e) => n + e.fixed, 0);
    const servers = list.map(e => e.server);
    return { id, name: fix ? fix.name : id, fixed: count, servers, note: fix ? fix.note(count, servers) : `${id}: ${count} changes` };
  });
}
