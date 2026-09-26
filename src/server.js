import http from 'node:http';
import fs from 'node:fs';
import { eventFile, getAllowlist, getSettings, pruneEvents, readEvents, setSettings } from './store.js';
import { CLIENT_IDS, setToolList } from './allowlist.js';
import { FIXES } from './compat.js';
import { buildSummary } from './summary.js';
import { applyTrim, applyVsCodeProfile, planTrim, planVsCodeProfile, resetTrim } from './trim.js';
import { runAudit } from './audit.js';
import { clientsReport } from './install.js';
import { ensureTrialStarted, licenseState, writeLicense } from './license.js';

const DASHBOARD = new URL('./dashboard.html', import.meta.url);
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Follow today's event file and hand new events to `onEvent`. */
function tailEvents(onEvent) {
  let file = eventFile();
  let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const timer = setInterval(() => {
    const current = eventFile();
    if (current !== file) {
      file = current;
      offset = 0;
    }
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    if (size <= offset) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const line of text.slice(0, lastNl).split('\n')) {
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore a malformed line
      }
    }
  }, 500);
  return () => clearInterval(timer);
}

export function startServer({ port = 7777, host = '127.0.0.1' } = {}) {
  const streams = new Set();
  const stopTail = tailEvents(e => {
    const data = `event: call\ndata: ${JSON.stringify(e)}\n\n`;
    for (const res of streams) res.write(data);
  });

  pruneEvents();
  ensureTrialStarted();
  const pruneTimer = setInterval(() => pruneEvents(), 6 * 3600000);
  pruneTimer.unref();

  const server = http.createServer(async (req, res) => {
    // Only answer requests addressed to this machine (blocks DNS rebinding).
    const hostHeader = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(hostHeader)) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    // State-changing calls need a custom header, which a cross-site page cannot send without a preflight we never approve.
    if (req.method === 'POST' && req.headers['x-headroom'] !== '1') return send(res, 403, { error: 'missing x-headroom header' });

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, fs.readFileSync(DASHBOARD, 'utf8'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { app: 'headroom', version: VERSION, pid: process.pid });
      }
      if (req.method === 'GET' && url.pathname === '/api/summary') {
        return send(res, 200, buildSummary({ days: Number(url.searchParams.get('days')) || 7 }));
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
        const hours = Number(url.searchParams.get('hours')) || 24;
        const since = Date.now() - hours * 3600000;
        const events = readEvents({ days: Math.ceil(hours / 24) + 1, since });
        return send(res, 200, events.slice(-limit).reverse());
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        streams.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          streams.delete(res);
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/trim/plan') {
        return send(res, 200, planTrim({ days: Number(url.searchParams.get('days')) || 7 }));
      }
      if (req.method === 'POST' && url.pathname === '/api/trim') {
        const body = await readBody(req);
        return send(res, 200, applyTrim({ days: body.days || 7, includeIdle: !!body.includeIdle }));
      }
      if (req.method === 'GET' && url.pathname === '/api/profile/vscode') {
        return send(res, 200, planVsCodeProfile());
      }
      if (req.method === 'POST' && url.pathname === '/api/profile/vscode') {
        return send(res, 200, applyVsCodeProfile());
      }
      if (req.method === 'GET' && url.pathname === '/api/allowlist') {
        return send(res, 200, { allowlist: getAllowlist(), writeToolsOff: getSettings().writeToolsOff, clients: CLIENT_IDS });
      }
      if (req.method === 'POST' && url.pathname === '/api/allowlist') {
        const body = await readBody(req);
        if (typeof body.server !== 'string' || typeof body.client !== 'string') return send(res, 400, { error: 'server and client are required' });
        if (body.tools !== null && !(Array.isArray(body.tools) && body.tools.every(t => typeof t === 'string'))) return send(res, 400, { error: 'tools must be a list of names, or null to clear' });
        return send(res, 200, { allowlist: setToolList(body.server, body.client, body.tools) });
      }
      if (req.method === 'POST' && url.pathname === '/api/trim/reset') {
        const body = await readBody(req);
        resetTrim(body.server);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/pause') {
        const body = await readBody(req);
        return send(res, 200, setSettings({ paused: !!body.paused }));
      }
      if (req.method === 'GET' && url.pathname === '/api/license') {
        return send(res, 200, licenseState());
      }
      if (req.method === 'POST' && url.pathname === '/api/license') {
        const body = await readBody(req);
        if (!['active', 'none'].includes(body.status)) return send(res, 400, { error: 'status must be active or none' });
        const num = v => (Number.isFinite(v) ? v : null);
        writeLicense({ status: body.status, validatedAt: num(body.validatedAt), updatesUntil: num(body.updatesUntil), email: typeof body.email === 'string' ? body.email : null });
        return send(res, 200, licenseState());
      }
      if (req.method === 'GET' && url.pathname === '/api/clients') {
        return send(res, 200, clientsReport());
      }
      if (req.method === 'GET' && url.pathname === '/api/settings') {
        return send(res, 200, getSettings());
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const body = await readBody(req);
        const patch = {};
        const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
        if ('contextWindow' in body) {
          if (!int(body.contextWindow, 1000, 10000000)) return send(res, 400, { error: 'contextWindow must be a whole number of tokens' });
          patch.contextWindow = body.contextWindow;
        }
        if ('budgetPct' in body) {
          if (!int(body.budgetPct, 1, 100)) return send(res, 400, { error: 'budgetPct must be 1 to 100' });
          patch.budgetPct = body.budgetPct;
        }
        if ('retentionDays' in body) {
          if (!int(body.retentionDays, 1, 3650)) return send(res, 400, { error: 'retentionDays must be 1 to 3650' });
          patch.retentionDays = body.retentionDays;
        }
        if ('paused' in body) patch.paused = !!body.paused;
        if ('notifyOverBudget' in body) patch.notifyOverBudget = !!body.notifyOverBudget;
        if ('notifyFailures' in body) patch.notifyFailures = !!body.notifyFailures;
        if ('compat' in body) {
          const ids = FIXES.map(f => f.id);
          if (!body.compat || typeof body.compat !== 'object' || Object.entries(body.compat).some(([id, on]) => !ids.includes(id) || typeof on !== 'boolean')) {
            return send(res, 400, { error: `compat must map fix ids (${ids.join(', ')}) to true or false` });
          }
          patch.compat = { ...(getSettings().compat || {}), ...body.compat };
        }
        if ('writeToolsOff' in body) patch.writeToolsOff = !!body.writeToolsOff;
        const next = setSettings(patch);
        if ('retentionDays' in patch) pruneEvents();
        return send(res, 200, next);
      }
      if (req.method === 'POST' && url.pathname === '/api/audit') {
        return send(res, 200, await runAudit());
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });

  server.on('close', () => {
    stopTail();
    clearInterval(pruneTimer);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
