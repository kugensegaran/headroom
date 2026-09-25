import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-'));
process.env.HEADROOM_HOME = path.join(tmp, 'data');
process.env.HEADROOM_USER_HOME = path.join(tmp, 'home');
const CLI = new URL('../src/cli.js', import.meta.url).pathname;
const FAKE = new URL('./fake-server.js', import.meta.url).pathname;

const { readEvents, setAllowlist } = await import('../src/store.js');
const { buildSummary } = await import('../src/summary.js');
const { applyInstall, isWrapped } = await import('../src/install.js');
const { planTrim } = await import('../src/trim.js');
const { runAudit } = await import('../src/audit.js');
const { startServer } = await import('../src/server.js');
const { knownClients } = await import('../src/clients.js');

/** Drive the proxy like a client would: send messages, collect responses by id. */
function session(name = 'fake') {
  const p = spawn(process.execPath, [CLI, 'proxy', '--name', name, '--', process.execPath, FAKE], { env: process.env });
  const waiting = new Map();
  let buf = '';
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const req = (method, params) =>
    new Promise(res => {
      const n = ++id;
      waiting.set(n, res);
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return { req, close: () => new Promise(r => { p.on('exit', r); p.stdin.end(); }) };
}

before(() => {
  const home = process.env.HEADROOM_USER_HOME;
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [FAKE] }, remote: { url: 'https://example.invalid/mcp' } } }));
});

test('proxy passes traffic through and logs each call', async () => {
  const s = session();
  const init = await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client' } });
  assert.equal(init.result.serverInfo.name, 'fake');
  const list = await s.req('tools/list', {});
  assert.equal(list.result.tools.length, 4);
  const ok = await s.req('tools/call', { name: 'search', arguments: { q: 'x' } });
  assert.equal(ok.result.content[0].text, 'ran search');
  const bad = await s.req('tools/call', { name: 'fail', arguments: {} });
  assert.equal(bad.result.isError, true);
  await s.close();

  const calls = readEvents().filter(e => e.method === 'tools/call');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].client, 'test-client');
  assert.equal(calls[0].server, 'fake');
  assert.equal(calls[0].status, 'ok');
  assert.ok(calls[0].ms >= 10);
  assert.equal(calls[1].status, 'error');
});

test('summary reports tokens, usage, write tools', () => {
  const s = buildSummary();
  const fake = s.servers.find(x => x.name === 'fake');
  assert.equal(fake.toolCount, 4);
  assert.ok(fake.tokens > 50);
  assert.equal(fake.usedCount, 2);
  assert.deepEqual(fake.writeTools, ['delete_item']);
  assert.equal(s.today.calls, 2);
  assert.equal(s.today.failed, 1);
});

test('trim plan keeps only used tools and proxy enforces the allow-list', async () => {
  const plan = planTrim({ days: 7 });
  assert.deepEqual(plan.next.fake, ['fail', 'search']);
  assert.ok(plan.savedTokens > 0);
  setAllowlist(plan.next);

  const s = session();
  await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client' } });
  const list = await s.req('tools/list', {});
  assert.deepEqual(list.result.tools.map(t => t.name).sort(), ['fail', 'search']);
  const blocked = await s.req('tools/call', { name: 'delete_item', arguments: { id: '1' } });
  assert.equal(blocked.error.code, -32601);
  await s.close();
  assert.equal(readEvents().filter(e => e.status === 'blocked').length, 1);

  const sum = buildSummary();
  const fake = sum.servers.find(x => x.name === 'fake');
  assert.equal(fake.enabledCount, 2);
  assert.ok(fake.tokens < fake.tokensAll);
  setAllowlist({});
});

test('install wraps stdio servers, leaves remote ones, and uninstall restores', () => {
  const cursor = knownClients().find(c => c.id === 'cursor');
  const r1 = applyInstall();
  const rc = r1.find(r => r.client === 'Cursor');
  assert.deepEqual(rc.changed, ['fake']);
  assert.deepEqual(rc.skipped, ['remote']);
  assert.ok(fs.existsSync(rc.backup));
  let cfg = JSON.parse(fs.readFileSync(cursor.file, 'utf8'));
  assert.ok(isWrapped(cfg.mcpServers.fake));
  assert.equal(cfg.mcpServers.remote.url, 'https://example.invalid/mcp');

  const r2 = applyInstall();
  assert.deepEqual(r2.find(r => r.client === 'Cursor').changed, [], 'install is idempotent');

  applyInstall({ undo: true });
  cfg = JSON.parse(fs.readFileSync(cursor.file, 'utf8'));
  assert.deepEqual(cfg.mcpServers.fake, { command: process.execPath, args: [FAKE] });
});

test('audit measures configured servers, including wrapped ones', async () => {
  applyInstall();
  const results = await runAudit({ only: ['fake'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].tools, 4);
  applyInstall({ undo: true });
});

test('dashboard API serves summary, events, guards writes and host', async () => {
  const server = await startServer({ port: 0 });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sum = await (await fetch(`${base}/api/summary`)).json();
  assert.ok(sum.servers.length >= 1);
  const events = await (await fetch(`${base}/api/events?limit=5`)).json();
  assert.ok(events.length >= 1);
  assert.ok(events[0].ts >= events[events.length - 1].ts, 'newest first');
  const html = await (await fetch(base)).text();
  assert.match(html, /Headroom/);
  const noHeader = await fetch(`${base}/api/pause`, { method: 'POST', body: '{}' });
  assert.equal(noHeader.status, 403);
  const paused = await (await fetch(`${base}/api/pause`, { method: 'POST', headers: { 'x-headroom': '1' }, body: JSON.stringify({ paused: false }) })).json();
  assert.equal(paused.paused, false);
  const http = await import('node:http');
  const evilStatus = await new Promise(res => http.get({ host: '127.0.0.1', port, path: '/api/summary', headers: { host: 'evil.example' } }, r => { r.resume(); res(r.statusCode); }));
  assert.equal(evilStatus, 403);
  server.closeAllConnections();
  server.close();
});

test('live stream pushes new calls', async () => {
  const server = await startServer({ port: 0 });
  const port = server.address().port;
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const got = (async () => {
    let text = '';
    while (!text.includes('event: call')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    return text;
  })();
  const s = session();
  await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stream-client' } });
  await s.req('tools/call', { name: 'read_item', arguments: { id: '1' } });
  await s.close();
  const text = await got;
  assert.match(text, /read_item/);
  ctrl.abort();
  server.closeAllConnections();
  server.close();
});

test('audit with no configured servers says so once', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-empty-'));
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [CLI, 'audit'], {
    env: { ...process.env, HEADROOM_HOME: path.join(empty, 'data'), HEADROOM_USER_HOME: path.join(empty, 'home') },
    encoding: 'utf8',
  });
  assert.match(out, /No MCP servers found/);
  assert.doesNotMatch(out, /No data yet/);
});
