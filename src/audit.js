import { discoverServers, transportOf } from './clients.js';
import { expandEntry, redact } from './expand.js';
import { unwrap } from './install.js';
import { listToolsHttp, listToolsStdio } from './mcpclient.js';
import { saveCatalog, setAuditStatus } from './store.js';
import { serverTokens } from './tokens.js';

function missingMessage(missing) {
  const inputs = missing.filter(m => m.startsWith('${input:'));
  if (inputs.length) return `needs ${inputs.join(', ')}, which only VS Code can ask for. Its tools are measured once the proxy sees them.`;
  const files = missing.filter(m => m.startsWith('envFile '));
  if (files.length) return `could not read ${files.map(f => f.slice(8)).join(', ')}.`;
  return `${missing.join(', ')} is not set in the environment Headroom runs in.`;
}

/** Connect to every configured server, capture its tool list and token cost. */
export async function runAudit({ only, concurrency = 4, onProgress = () => {} } = {}) {
  const byName = new Map();
  for (const s of discoverServers()) {
    if (only && !only.includes(s.name)) continue;
    const prev = byName.get(s.name);
    if (prev) prev.clients.push(s.clientLabel);
    else {
      const entry = unwrap(s.entry);
      byName.set(s.name, { ...s, entry, transport: transportOf(entry), clients: [s.clientLabel] });
    }
  }
  const queue = [...byName.values()];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      onProgress(s.name);
      const { entry, missing, secrets } = expandEntry(s.entry, { vars: s.vars });
      const base = { name: s.name, clients: s.clients, scope: s.scope, transport: s.transport, ...(s.readOnly ? { readOnly: s.readOnly } : {}) };
      try {
        if (missing.length) throw new Error(missingMessage(missing));
        const res = s.transport === 'http' ? await listToolsHttp(entry) : s.transport === 'stdio' ? await listToolsStdio(entry, { cwd: entry.cwd || s.cwd }) : null;
        if (!res) throw new Error('unknown transport');
        saveCatalog(s.name, res.tools, { tokens: serverTokens(res.tools), source: 'audit', transport: s.transport, clients: s.clients });
        results.push({ ...base, ok: true, tools: res.tools.length });
      } catch (err) {
        results.push({ ...base, ok: false, auth: !!err.auth, error: redact(err.message, secrets) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  setAuditStatus(Object.fromEntries(results.map(r => [r.name, { ok: r.ok, auth: !!r.auth, transport: r.transport, ts: Date.now() }])));
  return results;
}
