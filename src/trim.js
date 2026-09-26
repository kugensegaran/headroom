import { getAllowlist, readEvents, setAllowlist } from './store.js';
import { buildSummary } from './summary.js';
import { NEEDS_LICENCE, licenseState } from './license.js';
import { CLIENT_IDS, clientId } from './allowlist.js';

/**
 * Build allow-lists from real usage, per client: each app keeps the tools it actually
 * asked a server to run in the last `days` days. A server an app never called is left
 * untouched for that app (unless includeIdle), so a quiet week never breaks anything.
 */
export function planTrim({ days = 7, includeIdle = false, keep = {} } = {}) {
  const summary = buildSummary({ days });
  const used = {}; // server -> client -> Set(tool)
  for (const e of readEvents({ days })) {
    if (e.method !== 'tools/call' || !e.tool || e.status === 'blocked') continue;
    ((used[e.server] ||= {})[clientId(e.client)] ||= new Set()).add(e.tool);
  }
  const next = JSON.parse(JSON.stringify(getAllowlist()));
  const changes = [];
  for (const s of summary.servers) {
    const byClient = used[s.name] || {};
    const clients = Object.keys(byClient);
    if (!clients.length && !includeIdle) {
      changes.push({ server: s.name, action: 'skipped', reason: `no calls in ${days} days` });
      continue;
    }
    if (!clients.length) clients.push('*');
    let entry = next[s.name];
    entry = Array.isArray(entry) ? { '*': entry } : { ...(entry || {}) };
    for (const client of clients) {
      const tools = [...new Set([...(byClient[client] || []), ...(keep[s.name] || [])])].sort();
      const saved = s.tools.filter(t => !tools.includes(t.name)).reduce((sum, t) => sum + t.tokens, 0);
      entry[client] = tools;
      changes.push({ server: s.name, client, clientLabel: CLIENT_IDS[client] || client, action: 'trim', keep: tools.length, of: s.toolCount, savedTokens: saved });
    }
    next[s.name] = entry;
  }
  return { next, changes, savedTokens: changes.reduce((s, c) => s + (c.savedTokens || 0), 0) };
}

export function applyTrim(opts) {
  if (!licenseState().licensed) throw new Error(NEEDS_LICENCE);
  const plan = planTrim(opts);
  setAllowlist(plan.next);
  return plan;
}

export function resetTrim(server) {
  if (!server) return setAllowlist({});
  const next = { ...getAllowlist() };
  delete next[server];
  setAllowlist(next);
}

export const VSCODE_LIMIT = 128;

/**
 * A VS Code tool set that fits its 128-tool limit: tools VS Code actually used first,
 * then read-only tools, then the rest, smallest first, until 128.
 */
export function planVsCodeProfile({ days = 30, limit = VSCODE_LIMIT } = {}) {
  const summary = buildSummary({ days });
  const vscode = summary.perClient.find(c => c.id === 'vscode');
  const names = new Set(vscode ? vscode.measured : []);
  const used = new Set();
  for (const e of readEvents({ days })) {
    if (e.method === 'tools/call' && clientId(e.client) === 'vscode' && e.status !== 'blocked') used.add(`${e.server}\u0000${e.tool}`);
  }
  const candidates = summary.servers
    .filter(s => names.has(s.name))
    .flatMap(s => s.tools.map(t => ({ server: s.name, name: t.name, tokens: t.tokens, write: t.write, used: used.has(`${s.name}\u0000${t.name}`) })));
  const rank = t => (t.used ? 0 : t.write ? 2 : 1);
  candidates.sort((a, b) => rank(a) - rank(b) || a.tokens - b.tokens);
  const keep = candidates.slice(0, limit);
  const lists = {};
  for (const s of names) lists[s] = [];
  for (const t of keep) lists[t.server].push(t.name);
  return {
    total: candidates.length,
    limit,
    keep: keep.length,
    dropped: candidates.length - keep.length,
    savedTokens: candidates.slice(limit).reduce((n, t) => n + t.tokens, 0),
    lists,
  };
}

export function applyVsCodeProfile(opts) {
  if (!licenseState().licensed) throw new Error(NEEDS_LICENCE);
  const plan = planVsCodeProfile(opts);
  const next = JSON.parse(JSON.stringify(getAllowlist()));
  for (const [server, tools] of Object.entries(plan.lists)) {
    const entry = Array.isArray(next[server]) ? { '*': next[server] } : { ...(next[server] || {}) };
    entry.vscode = tools.sort();
    next[server] = entry;
  }
  setAllowlist(next);
  return plan;
}
