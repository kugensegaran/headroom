import { getAllowlist, readEvents, setAllowlist } from './store.js';
import { buildSummary } from './summary.js';
import { NEEDS_LICENCE, licenseState } from './license.js';

/**
 * Build an allow-list from real usage: keep the tools each server was actually
 * asked to run in the last `days` days. Servers with no calls are left untouched
 * unless includeIdle is set, so a quiet week never silently breaks a server.
 */
export function planTrim({ days = 7, includeIdle = false, keep = {} } = {}) {
  const summary = buildSummary({ days });
  const used = {};
  for (const e of readEvents({ days })) {
    if (e.method === 'tools/call' && e.tool && e.status !== 'blocked') (used[e.server] ||= new Set()).add(e.tool);
  }
  const next = { ...getAllowlist() };
  const changes = [];
  for (const s of summary.servers) {
    const u = used[s.name];
    if (!u && !includeIdle) {
      changes.push({ server: s.name, action: 'skipped', reason: `no calls in ${days} days` });
      continue;
    }
    const tools = [...new Set([...(u || []), ...(keep[s.name] || [])])].sort();
    const saved = s.tools.filter(t => !tools.includes(t.name)).reduce((sum, t) => sum + t.tokens, 0);
    next[s.name] = tools;
    changes.push({ server: s.name, action: 'trim', keep: tools.length, of: s.toolCount, savedTokens: saved });
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
