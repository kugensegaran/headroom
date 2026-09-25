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
  return drive(process.execPath, [CLI, 'proxy', '--name', name, '--', process.execPath, FAKE]);
}

function drive(command, args, env = process.env) {
  const p = spawn(command, args, { env });
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
  assert.deepEqual(rc.skipped.map(x => x.name), ['remote']);
  assert.match(rc.skipped[0].reason, /run an audit first/);
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

test('Claude Code project servers are found; ~/.claude.json blocks are wrapped, .mcp.json is left alone', async () => {
  const { discoverServers } = await import('../src/clients.js');
  const home = process.env.HEADROOM_USER_HOME;
  const proj = path.join(tmp, 'proj-a');
  fs.mkdirSync(proj, { recursive: true });
  // A relative path only works if the audit runs in the project directory.
  fs.writeFileSync(path.join(proj, 'srv.mjs'), `import ${JSON.stringify(FAKE)};\n`);
  const shared = { mcpServers: { shared: { command: process.execPath, args: ['./srv.mjs'] } } };
  fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify(shared));
  const claudeFile = path.join(home, '.claude.json');
  fs.writeFileSync(claudeFile, JSON.stringify({ numStartups: 3, projects: { [proj]: { allowedTools: [], mcpServers: { local: { command: process.execPath, args: [FAKE] } } }, '/gone': { mcpServers: {} } } }));

  const found = discoverServers().filter(s => s.client === 'claude-code');
  assert.deepEqual(found.map(s => [s.name, s.scope, !!s.readOnly]).sort(), [['local', 'project proj-a', false], ['shared', 'project proj-a', true]]);

  const results = await runAudit({ only: ['local', 'shared'] });
  assert.deepEqual(results.map(r => [r.name, r.ok, r.tools]).sort(), [['local', true, 4], ['shared', true, 4]]);

  const report = applyInstall();
  const cc = report.find(r => r.client === 'Claude Code');
  assert.deepEqual(cc.changed, ['local (project proj-a)']);
  const ro = report.find(r => r.readOnly);
  assert.deepEqual(ro.readOnly, ['shared']);
  let cfg = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  assert.ok(isWrapped(cfg.projects[proj].mcpServers.local));
  assert.equal(cfg.numStartups, 3, 'other keys survive');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proj, '.mcp.json'), 'utf8')), shared);

  applyInstall({ undo: true });
  cfg = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
  assert.deepEqual(cfg.projects[proj].mcpServers.local, { command: process.execPath, args: [FAKE] });
  fs.rmSync(claudeFile);
});

test('servers in enabled Claude Code plugins are audited but not rewritten', async () => {
  const { discoverServers } = await import('../src/clients.js');
  const home = process.env.HEADROOM_USER_HOME;
  const root = path.join(tmp, 'plugins', 'demo', '1.0.0');
  const off = path.join(tmp, 'plugins', 'off', '1.0.0');
  for (const dir of [root, off]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'srv.mjs'), `import ${JSON.stringify(FAKE)};\n`);
  }
  const mcp = { demo: { command: process.execPath, args: ['${CLAUDE_PLUGIN_ROOT}/srv.mjs'] } };
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(mcp));
  fs.writeFileSync(path.join(off, '.mcp.json'), JSON.stringify({ off: mcp.demo }));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'demo@market': true, 'off@market': false } }));
  fs.writeFileSync(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'demo@market': [{ scope: 'user', installPath: root }], 'off@market': [{ scope: 'user', installPath: off }] } })
  );

  const found = discoverServers().filter(s => s.scope?.startsWith('plugin'));
  assert.deepEqual(found.map(s => [s.name, s.scope]), [['demo', 'plugin demo']]);
  const [result] = await runAudit({ only: ['demo'] });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.tools, 4);

  const report = applyInstall({ dryRun: true });
  assert.deepEqual(report.find(r => r.client === 'Claude Code (plugin demo)').readOnly, ['demo']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')), mcp);
  fs.rmSync(path.join(home, '.claude'), { recursive: true });
});

test('VS Code inputs and env values are never printed or logged', async () => {
  const vscode = knownClients().find(c => c.id === 'vscode');
  fs.mkdirSync(path.dirname(vscode.file), { recursive: true });
  const secret = 'sk-live-supersecret-1234';
  const fileSecret = 'from-env-file-98765';
  const envFile = path.join(tmp, 'vs.env');
  fs.writeFileSync(envFile, `# comment\nexport FILE_TOKEN="${fileSecret}"\n`);
  const leak = "console.error('token=' + process.env.TOKEN + ' file=' + process.env.FILE_TOKEN + ' Authorization: Bearer abcdefgh12345678'); process.exit(3)";
  const servers = {
    prompted: { type: 'stdio', command: process.execPath, args: [FAKE], env: { API_KEY: '${input:api-key}' } },
    leaky: { type: 'stdio', command: process.execPath, args: ['-e', leak], env: { TOKEN: '${env:HR_TEST_SECRET}' }, envFile },
    vsfake: { type: 'stdio', command: '${env:HR_TEST_NODE}', args: [FAKE] },
  };
  const original = { inputs: [{ type: 'promptString', id: 'api-key', password: true }], servers };
  fs.writeFileSync(vscode.file, JSON.stringify(original));
  process.env.HR_TEST_SECRET = secret;
  process.env.HR_TEST_NODE = process.execPath;

  const started = Date.now();
  const results = Object.fromEntries((await runAudit({ only: ['prompted', 'leaky', 'vsfake'] })).map(r => [r.name, r]));
  assert.ok(Date.now() - started < 10000, 'a server that exits early fails fast');
  assert.equal(results.prompted.ok, false);
  assert.match(results.prompted.error, /\$\{input:api-key\}.*only VS Code/);
  assert.equal(results.leaky.ok, false);
  assert.match(results.leaky.error, /exited with code 3/);
  assert.ok(!results.leaky.error.includes(secret) && !results.leaky.error.includes(fileSecret) && !results.leaky.error.includes('abcdefgh12345678'), results.leaky.error);
  assert.match(results.leaky.error, /token=\*\*\* file=\*\*\* Authorization: Bearer \*\*\*/);
  assert.equal(results.vsfake.ok, true, results.vsfake.error);

  // Install keeps variables literal so VS Code still substitutes them, and writes a private backup.
  const report = applyInstall().find(r => r.client === 'VS Code');
  const cfg = JSON.parse(fs.readFileSync(vscode.file, 'utf8'));
  assert.deepEqual(cfg.inputs, original.inputs);
  assert.equal(cfg.servers.prompted.env.API_KEY, '${input:api-key}');
  assert.ok(cfg.servers.leaky.args.includes(leak));
  assert.equal(fs.statSync(report.backup).mode & 0o777, 0o600);
  applyInstall({ undo: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(vscode.file, 'utf8')), original);

  // Nothing Headroom stores on disk contains the secret.
  const stored = fs.readdirSync(process.env.HEADROOM_HOME, { recursive: true })
    .map(f => path.join(process.env.HEADROOM_HOME, f))
    .filter(f => fs.statSync(f).isFile() && !f.includes('backups'))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
  assert.ok(!stored.includes(secret));
  fs.rmSync(vscode.file);
  delete process.env.HR_TEST_SECRET;
});

test('bridge proxies a remote HTTP server over stdio and logs its calls', async () => {
  const { startFakeHttp, TOKEN } = await import('./fake-http-server.js');
  const fake = await startFakeHttp();
  const s = drive(process.execPath, [CLI, 'bridge', '--name', 'remotefake', '--url', `${fake.url}/mcp`, '--header', `Authorization: Bearer ${TOKEN}`]);
  const init = await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bridge-client' } });
  assert.equal(init.result.serverInfo.name, 'fake-http');
  const list = await s.req('tools/list', {});
  assert.equal(list.result.tools.length, 2);
  const call = await s.req('tools/call', { name: 'lookup', arguments: { q: 'x' } });
  assert.equal(call.result.content[0].text, 'remote ran lookup');
  await s.close();
  assert.equal(fake.seen.sessionsMissing, 0, 'session id is sent after initialize');
  assert.equal(fake.seen.deletes, 1, 'session is closed on exit');

  const calls = readEvents().filter(e => e.server === 'remotefake' && e.method === 'tools/call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].client, 'bridge-client');
  assert.equal(calls[0].status, 'ok');
  assert.ok(buildSummary().servers.find(x => x.name === 'remotefake'));

  // A server that wants OAuth gets a clear JSON-RPC error, not a hang.
  const o = drive(process.execPath, [CLI, 'bridge', '--name', 'oauthy', '--url', `${fake.url}/oauth`]);
  const denied = await o.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x' } });
  assert.match(denied.error.message, /needs sign-in/);
  await o.close();
  fake.server.close();
});

test('install bridges remote servers the audit reached, skips OAuth ones, and uninstall restores them', async () => {
  const { startFakeHttp, TOKEN } = await import('./fake-http-server.js');
  const fake = await startFakeHttp();
  const claudeFile = path.join(process.env.HEADROOM_USER_HOME, '.claude.json');
  const original = {
    mcpServers: {
      remotefake: { type: 'http', url: `${fake.url}/mcp`, headers: { Authorization: 'Bearer ${HR_REMOTE_TOKEN}' } },
      oauthy: { type: 'http', url: `${fake.url}/oauth` },
      legacy: { type: 'sse', url: `${fake.url}/sse` },
    },
  };
  fs.writeFileSync(claudeFile, JSON.stringify(original));
  process.env.HR_REMOTE_TOKEN = TOKEN;

  const reasons = () => Object.fromEntries(applyInstall({ dryRun: true }).find(r => r.client === 'Claude Code').skipped.map(x => [x.name, x.reason]));
  assert.match(reasons().remotefake, /run an audit first/);

  const audit = Object.fromEntries((await runAudit({ only: ['remotefake', 'oauthy'] })).map(r => [r.name, r]));
  assert.equal(audit.remotefake.ok, true, audit.remotefake.error);
  assert.equal(audit.oauthy.auth, true);

  const report = applyInstall().find(r => r.client === 'Claude Code');
  assert.deepEqual(report.changed, ['remotefake']);
  assert.match(report.skipped.find(x => x.name === 'oauthy').reason, /OAuth/);
  assert.match(report.skipped.find(x => x.name === 'legacy').reason, /SSE/);

  const wrapped = JSON.parse(fs.readFileSync(claudeFile, 'utf8')).mcpServers.remotefake;
  assert.ok(isWrapped(wrapped));
  assert.equal(wrapped.type, 'stdio');
  assert.ok(!wrapped.args.join(' ').includes('Bearer'), 'headers never go on the command line');

  // Run it the way the client would.
  const s = drive(wrapped.command, wrapped.args, { ...process.env, ...wrapped.env });
  await s.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } });
  const call = await s.req('tools/call', { name: 'send_message', arguments: { to: 'a' } });
  assert.equal(call.result.content[0].text, 'remote ran send_message');
  await s.close();

  const again = await runAudit({ only: ['remotefake'] });
  assert.equal(again[0].ok, true, 'audit sees through the wrapper');

  applyInstall({ undo: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(claudeFile, 'utf8')), original);
  fs.rmSync(claudeFile);
  delete process.env.HR_REMOTE_TOKEN;
  fake.server.close();
});

test('old event files are pruned by the retention setting', async () => {
  const { pruneEvents, dayKey, getSettings } = await import('../src/store.js');
  assert.equal(getSettings().retentionDays, 30);
  const dir = path.join(process.env.HEADROOM_HOME, 'events');
  const day = 86400000;
  const now = Date.now();
  const names = [0, 29, 30, 45].map(d => `events-${dayKey(now - d * day)}.jsonl`);
  for (const n of names) if (!fs.existsSync(path.join(dir, n))) fs.writeFileSync(path.join(dir, n), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
  const removed = pruneEvents({ now });
  assert.deepEqual(removed.sort(), [names[2], names[3]].sort());
  assert.ok(fs.existsSync(path.join(dir, names[0])) && fs.existsSync(path.join(dir, names[1])));
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
  assert.deepEqual(pruneEvents({ now, days: 1 }), [names[1]]);
  assert.ok(readEvents().length > 0, "today's events survive");
});

test('settings API validates and saves', async () => {
  const server = await startServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'x-headroom': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ retentionDays: 0 })).status, 400);
  assert.equal((await post({ budgetPct: 'lots' })).status, 400);
  const ok = await (await post({ retentionDays: 14, budgetPct: 25, contextWindow: 1000000 })).json();
  assert.equal(ok.retentionDays, 14);
  const got = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual([got.retentionDays, got.budgetPct, got.contextWindow], [14, 25, 1000000]);
  await post({ retentionDays: 30, budgetPct: 20, contextWindow: 200000 });
  server.close();
});
