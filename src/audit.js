import { discoverServers } from './clients.js';
import { unwrap } from './install.js';
import { listToolsHttp, listToolsStdio } from './mcpclient.js';
import { saveCatalog } from './store.js';
import { serverTokens } from './tokens.js';

/** Connect to every configured server, capture its tool list and token cost. */
export async function runAudit({ only, concurrency = 4, onProgress = () => {} } = {}) {
  const byName = new Map();
  for (const s of discoverServers()) {
    if (only && !only.includes(s.name)) continue;
    const prev = byName.get(s.name);
    if (prev) prev.clients.push(s.clientLabel);
    else byName.set(s.name, { ...s, entry: unwrap(s.entry), clients: [s.clientLabel] });
  }
  const queue = [...byName.values()];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      onProgress(s.name);
      try {
        const res = s.transport === 'http' ? await listToolsHttp(s.entry) : s.transport === 'stdio' ? await listToolsStdio(s.entry) : null;
        if (!res) throw new Error('unknown transport');
        saveCatalog(s.name, res.tools, { tokens: serverTokens(res.tools), source: 'audit', transport: s.transport, clients: s.clients });
        results.push({ name: s.name, ok: true, tools: res.tools.length, clients: s.clients, transport: s.transport });
      } catch (err) {
        results.push({ name: s.name, ok: false, error: err.message, clients: s.clients, transport: s.transport });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return results;
}
