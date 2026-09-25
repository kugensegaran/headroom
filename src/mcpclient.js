import { spawn } from 'node:child_process';
import { lineReader, tryParse } from './lines.js';

const PROTOCOL = '2025-06-18';
const CLIENT_INFO = { name: 'mcpmeter-audit', version: '0.1.0' };

/** Connect to a stdio server, list its tools, and shut it down. */
export function listToolsStdio(entry, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry.command, entry.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(entry.env || {}) },
    });
    let nextId = 1;
    const waiting = new Map();
    let stderr = '';
    const done = (err, val) => {
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => done(new Error(`timed out after ${timeoutMs / 1000}s. ${stderr.slice(-300)}`)), timeoutMs);
    const request = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++;
        waiting.set(id, { res, rej });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });

    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', err => done(err));
    child.stdout.on(
      'data',
      lineReader(line => {
        const msg = tryParse(line);
        if (!msg || msg.id === undefined || !waiting.has(msg.id)) return;
        const w = waiting.get(msg.id);
        waiting.delete(msg.id);
        msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result);
      })
    );

    (async () => {
      const init = await request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const tools = [];
      let cursor;
      do {
        const page = await request('tools/list', cursor ? { cursor } : {});
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor);
      done(null, { serverInfo: init.serverInfo, tools });
    })().catch(err => done(err));
  });
}

/** Streamable HTTP: POST JSON-RPC, accept either JSON or an SSE response. */
export async function listToolsHttp(entry, { timeoutMs = 20000 } = {}) {
  const url = entry.url;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(entry.headers || {}) };
  let session;
  let id = 1;
  const call = async (method, params, notify = false) => {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: id++, method, params };
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) throw new Error('needs sign-in (OAuth). Run the audit through the Mac app after connecting it in your client.');
    if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}`);
    session = res.headers.get('mcp-session-id') || session;
    if (notify) return null;
    const text = await res.text();
    const payloads = (res.headers.get('content-type') || '').includes('text/event-stream')
      ? text.split('\n').filter(l => l.startsWith('data:')).map(l => tryParse(l.slice(5).trim()))
      : [tryParse(text)];
    const msg = payloads.find(p => p && p.id === body.id);
    if (!msg) throw new Error('no response');
    if (msg.error) throw new Error(msg.error.message);
    return msg.result;
  };
  const init = await call('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO });
  await call('notifications/initialized', undefined, true);
  const tools = [];
  let cursor;
  do {
    const page = await call('tools/list', cursor ? { cursor } : {});
    tools.push(...(page.tools || []));
    cursor = page.nextCursor;
  } while (cursor);
  return { serverInfo: init.serverInfo, tools };
}
