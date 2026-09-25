import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function eventFile(ts = Date.now()) {
  return path.join(paths.events(), `events-${dayKey(ts)}.jsonl`);
}

export function appendEvent(event) {
  fs.appendFileSync(eventFile(event.ts), JSON.stringify(event) + '\n');
}

/** Read events from the last `days` days, oldest first. */
export function readEvents({ days = 1, since = 0 } = {}) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const file = eventFile(now - i * 86400000);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.ts >= since) out.push(e);
      } catch {
        // skip a partially written line
      }
    }
  }
  return out;
}

export function getAllowlist() {
  return readJson(paths.allowlist(), {});
}

export function setAllowlist(value) {
  writeJson(paths.allowlist(), value);
}

export function getSettings() {
  return { paused: false, budgetPct: 20, contextWindow: 200000, ...readJson(paths.settings(), {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(paths.settings(), next);
  return next;
}

/** Tool catalog per server, captured from tools/list by the proxy or the audit. */
export function saveCatalog(server, tools, meta = {}) {
  const safe = server.replace(/[^a-zA-Z0-9_.-]/g, '_');
  writeJson(path.join(paths.catalog(), `${safe}.json`), { server, updated: Date.now(), ...meta, tools });
}

export function readCatalogs() {
  const dir = paths.catalog();
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(dir, f), null))
    .filter(Boolean);
}
