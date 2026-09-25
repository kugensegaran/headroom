import fs from 'node:fs';
import { home } from './paths.js';

/**
 * Resolve the variables clients allow in server entries, for the audit only
 * (install keeps entries literal so the client still does its own substitution).
 *   Claude Code: ${NAME}, ${NAME:-default}, ${CLAUDE_PLUGIN_ROOT}
 *   VS Code / Cursor: ${env:NAME}, ${userHome}, ${workspaceFolder}, ${input:id}
 * ${input:id} values live in VS Code's secret storage, so they cannot be resolved here.
 * Returns the expanded entry, what could not be resolved, and every substituted value
 * (so callers can keep them out of anything they print or store).
 */
export function expandEntry(entry, { vars = {}, env = process.env } = {}) {
  const missing = new Set();
  const secrets = new Set();
  const sub = str =>
    typeof str !== 'string'
      ? str
      : str.replace(/\$\{([^}]+)\}/g, (whole, expr) => {
          let value;
          let fromEnv = false;
          if (expr.startsWith('input:')) {
            missing.add(whole);
            return whole;
          }
          if (expr.startsWith('env:')) [value, fromEnv] = [env[expr.slice(4)], true];
          else if (expr === 'userHome') value = home();
          else if (expr in vars) value = vars[expr];
          else {
            const [name, fallback] = expr.split(':-');
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return whole;
            fromEnv = name in env;
            value = env[name] ?? fallback;
          }
          if (value === undefined) {
            missing.add(whole);
            return '';
          }
          if (fromEnv && value.length >= 6) secrets.add(value);
          return value;
        });
  const map = obj => (obj && typeof obj === 'object' ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sub(v)])) : obj);
  const out = { ...entry };
  for (const k of ['command', 'url', 'cwd', 'envFile']) if (k in out) out[k] = sub(out[k]);
  if (Array.isArray(out.args)) out.args = out.args.map(sub);
  if (out.env) out.env = map(out.env);
  // VS Code: envFile holds KEY=VALUE lines; values in `env` win.
  if (typeof out.envFile === 'string' && out.envFile) {
    try {
      out.env = { ...parseEnvFile(fs.readFileSync(out.envFile, 'utf8')), ...(out.env || {}) };
    } catch {
      missing.add(`envFile ${out.envFile}`);
    }
  }
  if (out.headers) out.headers = map(out.headers);
  // Values the user typed straight into env or headers are just as secret as substituted ones.
  for (const v of [...Object.values(out.env || {}), ...Object.values(out.headers || {})]) if (typeof v === 'string' && v.length >= 6 && !/^\$\{[^}]+\}$/.test(v)) secrets.add(v);
  return { entry: out, missing: [...missing], secrets: [...secrets] };
}

/** Replace every secret value (and the token part of auth headers) in text with ***. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
  return out.replace(/(bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***');
}

export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
