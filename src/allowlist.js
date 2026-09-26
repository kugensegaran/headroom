import { getAllowlist, getSettings, setAllowlist } from './store.js';
import { isWriteTool } from './tokens.js';

/** Stable id for the client behind an initialize request's clientInfo.name. */
export function clientId(name = '') {
  if (name === 'claude-ai') return 'claude-desktop';
  if (/^local-agent-mode/.test(name)) return 'claude-cowork';
  if (name === 'claude-code') return 'claude-code';
  if (/cursor/i.test(name)) return 'cursor';
  if (/visual studio code|vscode/i.test(name)) return 'vscode';
  return name || 'unknown';
}

export const CLIENT_IDS = { 'claude-desktop': 'Claude Desktop', 'claude-cowork': 'Claude Cowork', 'claude-code': 'Claude Code', cursor: 'Cursor', vscode: 'VS Code' };

/**
 * The explicit tool list for one server and client, or null for "no list".
 * allowlist.json: { server: [tools] } (every client, older format) or
 *                 { server: { "*": [tools], "<client id>": [tools] } }
 */
export function listFor(allow, server, client) {
  const entry = allow[server];
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === 'object') return entry[client] || entry['*'] || null;
  return null;
}

/**
 * Whether a tool is on for a client. An explicit list wins. Without one, everything is on,
 * except write and delete tools when the writeToolsOff setting is on (new installs).
 */
export function toolAllowed({ allow = getAllowlist(), settings = getSettings(), server, client, tool }) {
  const list = listFor(allow, server, client);
  if (list) return list.includes(tool);
  return !(settings.writeToolsOff && isWriteTool(tool));
}

/** Set (tools array) or clear (null) the list for one server and client ('*' for every client). */
export function setToolList(server, client, tools) {
  const allow = { ...getAllowlist() };
  let entry = allow[server];
  entry = Array.isArray(entry) ? { '*': entry } : { ...(entry || {}) };
  if (tools === null) delete entry[client];
  else entry[client] = [...new Set(tools)].sort();
  if (Object.keys(entry).length) allow[server] = entry;
  else delete allow[server];
  setAllowlist(allow);
  return allow;
}
