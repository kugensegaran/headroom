import fs from 'node:fs';
import path from 'node:path';
import { getAt, knownClients, readClientConfig, readOnlySources, readJsonFile, serverBlocks, transportOf } from './clients.js';
import { cliPath, paths } from './paths.js';

export function isWrapped(entry) {
  const a = entry.args || [];
  return a.length > 3 && typeof a[0] === 'string' && a[0].endsWith(path.join('src', 'cli.js')) && a[1] === 'proxy';
}

export function wrap(name, entry) {
  if (transportOf(entry) !== 'stdio' || isWrapped(entry)) return entry;
  return {
    ...entry,
    command: process.execPath,
    args: [cliPath(), 'proxy', '--name', name, '--', entry.command, ...(entry.args || [])],
  };
}

export function unwrap(entry) {
  if (!isWrapped(entry)) return entry;
  const a = entry.args;
  const sep = a.indexOf('--');
  return { ...entry, command: a[sep + 1], args: a.slice(sep + 2) };
}

function backup(client) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(paths.backups(), `${client.id}-${stamp}.json`);
  fs.copyFileSync(client.file, dest);
  return dest;
}

/**
 * Route every stdio server in every client config through the proxy (or back out).
 * Remote servers are left alone and reported.
 */
export function applyInstall({ undo = false, dryRun = false } = {}) {
  const report = [];
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
        const next = undo ? unwrap(entry) : wrap(name, entry);
        if (next !== entry) {
          servers[name] = next;
          changed.push(label(name));
        } else if (!undo && transportOf(entry) !== 'stdio') {
          skipped.push(label(name));
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
      const cfg = readJsonFile(src.file);
      const names = cfg && !cfg.__error ? Object.keys(cfg[src.key] || {}) : [];
      if (names.length) report.push({ client: `${src.label} (${src.scope})`, file: src.file, changed: [], skipped: [], readOnly: names, reason: src.reason });
    }
  }
  return report;
}
