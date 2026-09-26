import fs from 'node:fs';
import path from 'node:path';
import { home } from './paths.js';

/**
 * How each client puts MCP tool definitions in front of the model, and where that fact comes from.
 *   on-demand   only names up front, full definitions fetched when needed
 *   every-turn  every definition sent with every request
 *   unverified  not checked yet; shown as such, never assumed
 */
export const LOADING = {
  'claude-desktop': { loading: 'unverified', source: 'Not checked yet' },
  'claude-code': { loading: 'on-demand', source: 'Checked with /context on 2026-09-26' },
  cursor: { loading: 'on-demand', source: 'Cursor docs: dynamic context discovery' },
  vscode: { loading: 'every-turn', limit: 128, source: 'VS Code docs: all tools up to 128 per request' },
};

/** Context windows we have seen a client report. Anything else falls back to Settings. */
const MODEL_WINDOWS = {
  'claude-opus-5-5': 1000000, // Claude Code /context, 2026-09-26
};

export function windowForModel(model) {
  if (!model) return null;
  if (/\[1m\]/i.test(model)) return 1000000;
  const key = Object.keys(MODEL_WINDOWS).find(k => model.startsWith(k));
  return key ? MODEL_WINDOWS[key] : null;
}

/**
 * The model of the most recent Claude Code session. Reads only the tail of the newest
 * transcript and only its "model" field; message content is never parsed or kept.
 */
export function latestClaudeCodeModel(root = path.join(home(), '.claude', 'projects')) {
  let newest = null;
  try {
    for (const dir of fs.readdirSync(root)) {
      const full = path.join(root, dir);
      let files;
      try {
        files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const p = path.join(full, f);
        const m = fs.statSync(p).mtimeMs;
        if (!newest || m > newest.m) newest = { p, m };
      }
    }
  } catch {
    return null;
  }
  if (!newest) return null;
  const size = fs.statSync(newest.p).size;
  const len = Math.min(size, 256 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(newest.p, 'r');
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  const found = [...buf.toString('utf8').matchAll(/"model":"(claude-[A-Za-z0-9.\-[\]]+)"/g)];
  return found.length ? found[found.length - 1][1] : null;
}

/** Context window per client: detected where the client tells us, otherwise the Settings value. */
export function contextWindows(settingsWindow) {
  const out = {};
  for (const id of Object.keys(LOADING)) out[id] = { window: settingsWindow, source: 'Settings' };
  const model = latestClaudeCodeModel();
  const detected = windowForModel(model);
  if (detected) out['claude-code'] = { window: detected, source: `Detected: ${model}` };
  return out;
}
