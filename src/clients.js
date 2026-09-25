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

export function readClientConfig(client) {
  if (!fs.existsSync(client.file)) return null;
  try {
    return JSON.parse(fs.readFileSync(client.file, 'utf8'));
  } catch (err) {
    return { __error: `Could not parse ${client.file}: ${err.message}` };
  }
}

/** Normalised server entries across every client config found on this machine. */
export function discoverServers() {
  const found = [];
  for (const client of knownClients()) {
    const cfg = readClientConfig(client);
    if (!cfg || cfg.__error) continue;
    const servers = cfg[client.key] || {};
    for (const [name, entry] of Object.entries(servers)) {
      found.push({ client: client.id, clientLabel: client.label, name, entry, transport: transportOf(entry) });
    }
  }
  return found;
}

export function transportOf(entry) {
  if (entry.command) return 'stdio';
  if (entry.url || entry.type === 'http' || entry.type === 'sse') return 'http';
  return 'unknown';
}
