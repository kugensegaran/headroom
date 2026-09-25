import { spawn } from 'node:child_process';
import { lineReader, tryParse } from './lines.js';
import { appendEvent, getAllowlist, getSettings, saveCatalog } from './store.js';
import { isWriteTool, serverTokens } from './tokens.js';

/**
 * Sit between an MCP client and a stdio MCP server.
 * Every message is passed through unchanged, except:
 *  - tools/list results are filtered to the server's allow-list (if one exists)
 *  - tools/call for a tool outside the allow-list gets a JSON-RPC error
 * Every request/response pair is logged as one event.
 */
export function runProxy({ name, command, args, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr }) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const pending = new Map(); // id -> { ts, method, tool, bytes }
  let clientName = 'unknown';

  const allowed = () => {
    const list = getAllowlist()[name];
    return Array.isArray(list) ? new Set(list) : null;
  };

  const log = event => {
    if (getSettings().paused) return;
    try {
      appendEvent({ server: name, client: clientName, ...event });
    } catch (err) {
      stderr.write(`[mcpmeter] could not write event: ${err.message}\n`);
    }
  };

  const toClient = obj => stdout.write(JSON.stringify(obj) + '\n');

  // client -> server
  stdin.on(
    'data',
    lineReader(line => {
      const msg = tryParse(line);
      if (msg && msg.method === 'initialize') {
        clientName = msg.params?.clientInfo?.name || clientName;
      }
      if (msg && msg.method === 'tools/call') {
        const tool = msg.params?.name;
        const allow = allowed();
        if (allow && !allow.has(tool)) {
          log({ ts: Date.now(), method: 'tools/call', tool, ms: 0, reqBytes: line.length, resBytes: 0, status: 'blocked', write: isWriteTool(tool || '') });
          toClient({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Tool "${tool}" is turned off in MCP Meter.` } });
          return;
        }
      }
      if (msg && msg.id !== undefined && msg.method) {
        pending.set(msg.id, { ts: Date.now(), method: msg.method, tool: msg.params?.name, bytes: line.length });
      }
      child.stdin.write(line + '\n');
    })
  );

  // server -> client
  child.stdout.on(
    'data',
    lineReader(line => {
      const msg = tryParse(line);
      if (msg && msg.id !== undefined && !msg.method && pending.has(msg.id)) {
        const req = pending.get(msg.id);
        pending.delete(msg.id);
        if (req.method === 'tools/list' && Array.isArray(msg.result?.tools)) {
          const all = msg.result.tools;
          saveCatalog(name, all, { tokens: serverTokens(all), source: 'proxy' });
          const allow = allowed();
          if (allow) {
            msg.result.tools = all.filter(t => allow.has(t.name));
            line = JSON.stringify(msg);
          }
        }
        const isError = !!msg.error || msg.result?.isError === true;
        if (req.method !== 'ping') {
          log({
            ts: req.ts,
            method: req.method,
            tool: req.method === 'tools/call' ? req.tool : undefined,
            ms: Date.now() - req.ts,
            reqBytes: req.bytes,
            resBytes: line.length,
            status: isError ? 'error' : 'ok',
            write: req.method === 'tools/call' ? isWriteTool(req.tool || '') : false,
          });
        }
      }
      stdout.write(line + '\n');
    })
  );

  child.stderr.pipe(stderr);
  stdin.on('end', () => child.stdin.end());
  child.on('exit', code => {
    if (stdout === process.stdout) process.exit(code ?? 0);
  });
  child.on('error', err => {
    stderr.write(`[mcpmeter] could not start ${command}: ${err.message}\n`);
    if (stdout === process.stdout) process.exit(1);
  });
  return child;
}
