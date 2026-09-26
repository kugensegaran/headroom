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
 * Server lists Headroom reads but never rewrites: shared project files that may be
 * checked into a repo, and servers bundled in Claude Code plugins.
 * Returns [{ client, label, scope, file, servers, vars, cwd, reason }].
 */
export function readOnlySources() {
  const out = [];
  const h = home();
  const claudeCode = knownClients().find(c => c.id === 'claude-code');
  const cfg = readJsonFile(claudeCode.file);
  const dirs = cfg && !cfg.__error && cfg.projects ? Object.keys(cfg.projects) : [];
  for (const dir of dirs) {
    const file = path.join(dir, '.mcp.json');
    const json = readJsonFile(file);
    if (!json || json.__error) continue;
    out.push({ client: 'claude-code', label: 'Claude Code', scope: `project ${path.basename(dir)}`, file, servers: json.mcpServers, vars: {}, cwd: dir, reason: 'shared project file (.mcp.json), left unchanged' });
  }
  for (const plugin of enabledPlugins(h)) {
    const vars = { CLAUDE_PLUGIN_ROOT: plugin.root };
    const base = { client: 'claude-code', label: 'Claude Code', scope: `plugin ${plugin.name}`, vars, cwd: plugin.root, reason: 'plugin server, managed by the plugin' };
    const mcpFile = path.join(plugin.root, '.mcp.json');
    const mcp = readJsonFile(mcpFile);
    if (mcp && !mcp.__error) out.push({ ...base, file: mcpFile, servers: mcp.mcpServers || mcp });
    const manifestFile = path.join(plugin.root, '.claude-plugin', 'plugin.json');
    const manifest = readJsonFile(manifestFile);
    const declared = manifest && !manifest.__error ? manifest.mcpServers : null;
    if (declared && typeof declared === 'object') out.push({ ...base, file: manifestFile, servers: declared });
    else if (typeof declared === 'string') {
      const file = path.resolve(plugin.root, declared.replace('${CLAUDE_PLUGIN_ROOT}', plugin.root));
      const json = readJsonFile(file);
      if (json && !json.__error && file !== mcpFile) out.push({ ...base, file, servers: json.mcpServers || json });
    }
  }
  return out;
}

/** Installed Claude Code plugins that are switched on in ~/.claude/settings.json. */
function enabledPlugins(h) {
  const settings = readJsonFile(path.join(h, '.claude', 'settings.json'));
  const enabled = settings && !settings.__error ? settings.enabledPlugins || {} : {};
  const installed = readJsonFile(path.join(h, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = installed && !installed.__error ? installed.plugins || {} : {};
  const out = [];
  for (const [key, value] of Object.entries(plugins)) {
    if (enabled[key] !== true) continue;
    // v2 keeps a list of installs per plugin, v1 a single object.
    const installs = Array.isArray(value) ? value : [value];
    const root = installs.map(i => i && i.installPath).find(p => p && fs.existsSync(p));
    if (root) out.push({ name: key.split('@')[0], root });
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
    for (const block of serverBlocks(client, cfg)) add(client.id, client.label, block.scope, getAt(cfg, block.path), { cwd: block.project, vars: block.project ? { workspaceFolder: block.project } : {} });
  }
  for (const src of readOnlySources()) add(src.client, src.label, src.scope, src.servers, { readOnly: src.reason, file: src.file, cwd: src.cwd, vars: { workspaceFolder: src.cwd, ...src.vars } });
  return found;
}

export function transportOf(entry) {
  if (entry.command) return 'stdio';
  if (entry.url || entry.type === 'http' || entry.type === 'sse') return 'http';
  return 'unknown';
}

/** Friendly name for the clientInfo.name a client sends in initialize. */
export function clientLabel(name = '') {
  if (name === 'claude-ai') return 'Claude';
  if (name === 'claude-code') return 'Claude Code';
  // Claude Desktop's Cowork mode names itself per server, e.g. local-agent-mode-memory.
  if (/^local-agent-mode/.test(name)) return 'Claude Cowork';
  if (/cursor/i.test(name)) return 'Cursor';
  if (/visual studio code|vscode/i.test(name)) return 'VS Code';
  return name || 'unknown';
}
