import fs from 'node:fs';
import path from 'node:path';
import { home } from './paths.js';

/**
 * Where each MCP client keeps its server config, and which key holds the servers.
 * macOS paths first; Linux fallbacks so the engine can be tested anywhere.
 */
export function knownClients() {
  const h = home();
  const mac = process.platform === 'darwin';
  const appSupport = mac ? path.join(h, 'Library', 'Application Support') : path.join(h, '.config');
  return [
    { id: 'claude-desktop', label: 'Claude Desktop', file: path.join(appSupport, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers' },
    { id: 'claude-code', label: 'Claude Code', file: path.join(h, '.claude.json'), key: 'mcpServers' },
    { id: 'cursor', label: 'Cursor', file: path.join(h, '.cursor', 'mcp.json'), key: 'mcpServers' },
    { id: 'vscode', label: 'VS Code', file: path.join(appSupport, 'Code', 'User', 'mcp.json'), key: 'servers' },
  ];
}

export function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { __error: `Could not parse ${file}: ${err.message}` };
  }
}

export function readClientConfig(client) {
  return readJsonFile(client.file);
}

/**
 * The server maps inside one client config, as paths into the parsed JSON.
 * Claude Code keeps per-project servers under projects[<dir>].mcpServers in the same file.
 */
export function serverBlocks(client, cfg) {
  const blocks = [{ path: [client.key], scope: 'user' }];
  if (client.id === 'claude-code' && cfg.projects && typeof cfg.projects === 'object') {
    for (const [dir, project] of Object.entries(cfg.projects)) {
      if (project && typeof project.mcpServers === 'object') blocks.push({ path: ['projects', dir, 'mcpServers'], scope: `project ${path.basename(dir)}`, project: dir });
    }
  }
  return blocks;
}

export function getAt(obj, keys) {
  return keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Config files Headroom reads but never rewrites: shared project files that may be
 * checked into a repo. Returns [{ client, label, file, key, reason }].
 */
export function readOnlySources() {
  const out = [];
  const claudeCode = knownClients().find(c => c.id === 'claude-code');
  const cfg = readJsonFile(claudeCode.file);
  const dirs = cfg && !cfg.__error && cfg.projects ? Object.keys(cfg.projects) : [];
  for (const dir of dirs) {
    const file = path.join(dir, '.mcp.json');
    if (fs.existsSync(file)) {
      out.push({ client: 'claude-code', label: 'Claude Code', scope: `project ${path.basename(dir)}`, file, key: 'mcpServers', reason: 'shared project file (.mcp.json), left unchanged' });
    }
  }
  return out;
}

/** Normalised server entries across every client config found on this machine. */
export function discoverServers() {
  const found = [];
  const add = (client, clientLabel, scope, servers, extra) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || typeof entry !== 'object') continue;
      found.push({ client, clientLabel, scope, name, entry, transport: transportOf(entry), ...extra });
    }
  };
  for (const client of knownClients()) {
    const cfg = readClientConfig(client);
    if (!cfg || cfg.__error) continue;
    for (const block of serverBlocks(client, cfg)) add(client.id, client.label, block.scope, getAt(cfg, block.path), { project: block.project });
  }
  for (const src of readOnlySources()) {
    const cfg = readJsonFile(src.file);
    if (!cfg || cfg.__error) continue;
    add(src.client, src.label, src.scope, cfg[src.key], { readOnly: src.reason, file: src.file });
  }
  return found;
}

export function transportOf(entry) {
  if (entry.command) return 'stdio';
  if (entry.url || entry.type === 'http' || entry.type === 'sse') return 'http';
  return 'unknown';
}
