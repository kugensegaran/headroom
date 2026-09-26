import { spawn } from 'node:child_process';
import { lineReader, tryParse } from './lines.js';
import { appendEvent, getAllowlist, getSettings, saveCatalog } from './store.js';
import { isWriteTool, serverTokens } from './tokens.js';
import { isLicensed } from './license.js';
import { serverEnv } from './paths.js';
import { clientId, toolAllowed } from './allowlist.js';

/**
 * The part of the proxy that does not care how the server is reached.
 * Every message is passed through unchanged, except:
 *  - tools/list results are filtered to the server's allow-list (if one exists)
 *  - tools/call for a tool outside the allow-list gets a JSON-RPC error
 *  - with compatibility fixes on, tools/list results lose the `$schema` key of each
 *    inputSchema and outputSchema (Claude Desktop rejects draft-07 as an unsupported dialect)
 * Every request/response pair is logged as one event.
 * `toServer(line)` and `toClient(line)` deliver one JSON-RPC line each way.
 */
/** Drop `$schema` from each tool's inputSchema and outputSchema, in place. Returns how many were removed. */
export function stripSchemaDialects(tools) {
  let fixed = 0;
  for (const t of tools) {
    for (const key of ['inputSchema', 'outputSchema']) {
      const schema = t && t[key];
      if (schema && typeof schema === 'object' && '$schema' in schema) {
        delete schema.$schema;
        fixed++;
      }
    }
  }
  return fixed;
}

export function createTap({ name, toServer, toClient, stderr = process.stderr }) {
  const pending = new Map(); // id -> { ts, method, tool, bytes }
  let clientName = 'unknown';

  // Read fresh each time so allow-list changes apply without restarting the client.
  const allowed = () => {
    const allow = getAllowlist();
    const settings = getSettings();
    const client = clientId(clientName);
    return tool => toolAllowed({ allow, settings, server: name, client, tool });
  };

  const log = event => {
    if (getSettings().paused || !isLicensed()) return;
    try {
      appendEvent({ server: name, client: clientName, ...event });
    } catch (err) {
      stderr.write(`[headroom] could not write event: ${err.message}\n`);
    }
  };

  // client -> server
  const fromClient = line => {
    const msg = tryParse(line);
    if (msg && msg.method === 'initialize') {
      clientName = msg.params?.clientInfo?.name || clientName;
    }
    if (msg && msg.method === 'tools/call') {
      const tool = msg.params?.name;
      if (!allowed()(tool)) {
        log({ ts: Date.now(), method: 'tools/call', tool, ms: 0, reqBytes: line.length, resBytes: 0, status: 'blocked', write: isWriteTool(tool || '') });
        toClient(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Tool "${tool}" is turned off in Headroom for this app. Turn it on in the Headroom dashboard under Servers.` } }));
        return;
      }
    }
    if (msg && msg.id !== undefined && msg.method) {
      pending.set(msg.id, { ts: Date.now(), method: msg.method, tool: msg.params?.name, bytes: line.length });
    }
    toServer(line);
  };

  // server -> client
  const fromServer = line => {
    const msg = tryParse(line);
    if (msg && msg.id !== undefined && !msg.method && pending.has(msg.id)) {
      const req = pending.get(msg.id);
      pending.delete(msg.id);
      if (req.method === 'tools/list' && Array.isArray(msg.result?.tools)) {
        const all = msg.result.tools;
        const fixed = getSettings().compatFixes ? stripSchemaDialects(all) : 0;
        saveCatalog(name, all, { tokens: serverTokens(all), source: 'proxy' });
        const allow = allowed();
        const visible = all.filter(t => allow(t.name));
        if (visible.length !== all.length) msg.result.tools = visible;
        if (visible.length !== all.length || fixed) line = JSON.stringify(msg);
        if (fixed) log({ ts: Date.now(), method: 'compat', fix: 'schema-dialect', fixed, ms: 0, status: 'ok' });
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
    toClient(line);
  };

  return { fromClient, fromServer };
}

/** Sit between an MCP client and a stdio MCP server. */
export function runProxy({ name, command, args, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr }) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: serverEnv() });
  const tap = createTap({ name, stderr, toServer: line => child.stdin.write(line + '\n'), toClient: line => stdout.write(line + '\n') });

  stdin.on('data', lineReader(tap.fromClient));
  child.stdout.on('data', lineReader(tap.fromServer));
  child.stderr.pipe(stderr);
  child.stdin.on('error', () => {});
  stdin.on('end', () => child.stdin.end());
  child.on('exit', code => {
    if (stdout === process.stdout) process.exit(code ?? 0);
  });
  child.on('error', err => {
    stderr.write(`[headroom] could not start ${command}: ${err.message}\n`);
    if (stdout === process.stdout) process.exit(1);
  });
  return child;
}
