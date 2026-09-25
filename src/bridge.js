import { expandEntry } from './expand.js';
import { lineReader, tryParse } from './lines.js';
import { createTap } from './proxy.js';

/** Parse a text/event-stream body as it arrives and hand each `data:` payload to onData. */
async function readSse(body, onData) {
  const decoder = new TextDecoder();
  let buf = '';
  let data = [];
  const flush = () => {
    if (data.length) onData(data.join('\n'));
    data = [];
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line === '') flush();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  flush();
}

/**
 * A stdio MCP server that forwards every message to a streamable HTTP server,
 * so remote servers get the same logging and allow-list as local ones.
 * Headers usually hold API keys: they come in through the environment, never argv.
 */
export function runBridge({ name, url, headers = {}, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch }) {
  let session = null;
  let protocol = null;
  let listening = false;
  let closed = false;
  const inflight = new Set();

  const baseHeaders = () => ({
    ...headers,
    ...(session ? { 'mcp-session-id': session } : {}),
    ...(protocol ? { 'mcp-protocol-version': protocol } : {}),
  });

  const deliver = text => {
    const msg = tryParse(text);
    if (!msg) return;
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (m.id !== undefined && m.result?.protocolVersion && m.result?.serverInfo) {
        protocol = m.result.protocolVersion;
        queueMicrotask(openStream);
      }
      tap.fromServer(JSON.stringify(m));
    }
  };

  const failRequest = (msg, message) => {
    if (msg && msg.id !== undefined && msg.method) tap.fromServer(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message } }));
  };

  const post = async line => {
    const msg = tryParse(line);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...baseHeaders() },
        body: line,
      });
      session = res.headers.get('mcp-session-id') || session;
      if (res.status === 401 || res.status === 403) return failRequest(msg, `${name} needs sign-in (HTTP ${res.status}). Headroom cannot pass OAuth through, so connect this server directly in your client.`);
      if (res.status === 404 && session && msg?.method !== 'initialize') {
        session = null;
        return failRequest(msg, `${name} ended the session. Restart the client to reconnect.`);
      }
      if (!res.ok) return failRequest(msg, `${name} returned HTTP ${res.status}`);
      if (res.status === 202 || !res.body) return;
      const type = res.headers.get('content-type') || '';
      if (type.includes('text/event-stream')) await readSse(res.body, deliver);
      else deliver(await res.text());
    } catch (err) {
      failRequest(msg, `${name} is unreachable: ${err.message}`);
    }
  };

  // Server-initiated messages (notifications, sampling) arrive on an optional GET stream.
  let streamFailures = 0;
  const openStream = async () => {
    if (listening || closed || streamFailures >= 3) return;
    listening = true;
    try {
      const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'text/event-stream', ...baseHeaders() } });
      if (res.status === 405 || res.status === 404) return (streamFailures = 3);
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream')) throw new Error(`HTTP ${res.status}`);
      streamFailures = 0;
      await readSse(res.body, deliver);
    } catch {
      streamFailures++;
    } finally {
      listening = false;
    }
    if (!closed && streamFailures < 3) setTimeout(openStream, 1000 * (streamFailures + 1));
  };

  const tap = createTap({
    name,
    stderr,
    toClient: line => stdout.write(line + '\n'),
    toServer: line => {
      const p = post(line).finally(() => inflight.delete(p));
      inflight.add(p);
    },
  });

  stdin.on('data', lineReader(tap.fromClient));
  stdin.on('end', async () => {
    await Promise.allSettled([...inflight]);
    closed = true;
    if (session) await fetchImpl(url, { method: 'DELETE', headers: baseHeaders() }).catch(() => {});
    if (stdout === process.stdout) process.exit(0);
  });
  return { close: () => (closed = true) };
}

/** `--header "Name: value"` flags plus HEADROOM_BRIDGE (the original config entry, set by install). */
export function bridgeOptions(argv, env = process.env) {
  let url;
  const headers = {};
  if (env.HEADROOM_BRIDGE) {
    const original = expandEntry(tryParse(env.HEADROOM_BRIDGE) || {}, { env }).entry;
    url = original.url;
    Object.assign(headers, original.headers || {});
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i];
    else if (argv[i] === '--header') {
      const h = argv[++i] || '';
      const at = h.indexOf(':');
      if (at > 0) headers[h.slice(0, at).trim()] = h.slice(at + 1).trim();
    }
  }
  return { url, headers };
}
