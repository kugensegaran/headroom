import fs from 'node:fs';
import path from 'node:path';
import { getAt, knownClients, readClientConfig, readOnlySources, serverBlocks, transportOf } from './clients.js';
import { cliPath, paths } from './paths.js';
import { getAuditStatus } from './store.js';

export function isWrapped(entry) {
  const a = entry.args || [];
  if (a.length < 3 || typeof a[0] !== 'string' || !a[0].endsWith(path.join('src', 'cli.js'))) return false;
  return (a[1] === 'proxy' && a.includes('--')) || (a[1] === 'bridge' && typeof entry.env?.HEADROOM_BRIDGE === 'string');
}

/** Why a server cannot be routed through Headroom, or null when it can. */
export function wrapBlocker(entry, status) {
  const transport = transportOf(entry);
  if (transport === 'stdio' || isWrapped(entry)) return null;
  if (transport !== 'http') return 'unknown server type';
  if (entry.type === 'sse') return 'uses the older SSE transport, which the bridge does not support';
  if (!status) return 'remote; run an audit first so Headroom can check it works without OAuth';
  if (status.auth) return 'signs in with OAuth, which only the client can do';
  if (!status.ok) return 'remote, and the last audit could not reach it';
  return null;
}

export function wrap(name, entry) {
  if (isWrapped(entry)) return entry;
  if (transportOf(entry) === 'stdio') {
    return {
      ...entry,
      command: process.execPath,
      args: [cliPath(), 'proxy', '--name', name, '--', entry.command, ...(entry.args || [])],
    };
  }
  // Remote: the original entry rides along in env so headers stay out of argv and uninstall restores it exactly.
  return {
    ...(entry.type ? { type: 'stdio' } : {}),
    command: process.execPath,
    args: [cliPath(), 'bridge', '--name', name],
    env: { HEADROOM_BRIDGE: JSON.stringify(entry) },
  };
}

export function unwrap(entry) {
  if (!isWrapped(entry)) return entry;
  const a = entry.args;
  if (a[1] === 'bridge') return JSON.parse(entry.env.HEADROOM_BRIDGE);
  const sep = a.indexOf('--');
  return { ...entry, command: a[sep + 1], args: a.slice(sep + 2) };
}

function backup(client) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(paths.backups(), `${client.id}-${stamp}.json`);
  fs.copyFileSync(client.file, dest);
  fs.chmodSync(dest, 0o600); // configs often hold API keys
  return dest;
}

/**
 * Route every server in every client config through the proxy (or back out).
 * Remote servers go through the bridge when the last audit reached them without OAuth;
 * the rest are left alone and reported with a reason.
 */
export function applyInstall({ undo = false, dryRun = false } = {}) {
  const report = [];
  const status = getAuditStatus();
  for (const client of knownClients()) {
    const cfg = readClientConfig(client);
    if (!cfg) continue;
    if (cfg.__error) {
      report.push({ client: client.label, error: cfg.__error });
      continue;
    }
    const changed = [];
    const skipped = [];
    for (const block of serverBlocks(client, cfg)) {
      const servers = getAt(cfg, block.path);
      if (!servers || typeof servers !== 'object') continue;
      const label = name => (block.scope === 'user' ? name : `${name} (${block.scope})`);
      for (const [name, entry] of Object.entries(servers)) {
        if (!entry || typeof entry !== 'object') continue;
        const blocker = undo ? null : wrapBlocker(entry, status[name]);
        if (blocker) {
          skipped.push({ name: label(name), reason: blocker });
          continue;
        }
        const next = undo ? unwrap(entry) : wrap(name, entry);
        if (next !== entry) {
          servers[name] = next;
          changed.push(label(name));
        }
      }
    }
    let backupFile = null;
    if (changed.length && !dryRun) {
      backupFile = backup(client);
      fs.writeFileSync(client.file, JSON.stringify(cfg, null, 2) + '\n');
    }
    report.push({ client: client.label, file: client.file, changed, skipped, backup: backupFile });
  }
  if (!undo) {
    for (const src of readOnlySources()) {
      const names = src.servers && typeof src.servers === 'object' ? Object.keys(src.servers) : [];
      if (names.length) report.push({ client: `${src.label} (${src.scope})`, file: src.file, changed: [], skipped: [], readOnly: names, reason: src.reason });
    }
  }
  return report;
}
