// The website's free audit. Runs entirely in the browser: the pasted config never leaves the page.
// Servers are looked up in catalog.json, which scripts/build-catalog.js measures with the real app's audit.

/** Parse JSON that may carry comments or trailing commas (VS Code configs do). */
export function parseLoose(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Every server entry in a Claude Desktop, Claude Code, Cursor or VS Code config. */
export function serversIn(config) {
  const found = {};
  const take = obj => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [name, entry] of Object.entries(obj)) if (entry && typeof entry === 'object') found[name] = entry;
  };
  take(config.mcpServers);
  take(config.servers);
  take(config.mcp?.servers);
  if (config.projects && typeof config.projects === 'object') for (const p of Object.values(config.projects)) take(p?.mcpServers);
  // A bare map of servers, as in a plugin's .mcp.json.
  if (!Object.keys(found).length && Object.values(config).every(v => v && typeof v === 'object' && (v.command || v.url))) take(config);
  return found;
}

/** Undo a Headroom-wrapped entry so it matches the catalog. */
function original(entry) {
  const a = entry.args || [];
  if (a[1] === 'bridge' && entry.env?.HEADROOM_BRIDGE) {
    try {
      return JSON.parse(entry.env.HEADROOM_BRIDGE);
    } catch {
      return entry;
    }
  }
  if (a[1] === 'proxy' && a.includes('--')) return { command: a[a.indexOf('--') + 1], args: a.slice(a.indexOf('--') + 2) };
  return entry;
}

export function matchServer(entry, catalog) {
  const e = original(entry);
  const haystack = [e.command, ...(e.args || []), e.url].filter(Boolean).join(' ').toLowerCase();
  return catalog.servers.find(s => s.match.some(m => haystack.includes(m.toLowerCase()))) || null;
}

export function audit(configText, catalog, { contextWindow = 200000 } = {}) {
  const servers = serversIn(parseLoose(configText));
  const rows = Object.entries(servers).map(([name, entry]) => {
    const known = matchServer(entry, catalog);
    const e = original(entry);
    return {
      name,
      known: known ? known.name : null,
      remote: !e.command,
      tools: known ? known.tools.length : null,
      tokens: known ? known.tools.reduce((s, t) => s + t.tokens, 0) : null,
      toolList: known ? known.tools : [],
    };
  });
  rows.sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1));
  const owners = {};
  for (const r of rows) for (const t of r.toolList) (owners[t.name] ||= new Set()).add(r.name);
  const clashes = Object.entries(owners).filter(([, s]) => s.size > 1).map(([tool, s]) => ({ tool, servers: [...s] }));
  const writeTools = rows.flatMap(r => r.toolList.filter(t => t.write).map(t => t.name));
  const total = rows.reduce((s, r) => s + (r.tokens || 0), 0);
  return { rows, total, pct: total / contextWindow, contextWindow, clashes, writeTools, unknown: rows.filter(r => r.tokens === null).length };
}

/** The pasted config with the given servers removed, keeping everything else as it was. */
export function withoutServers(configText, remove) {
  const config = parseLoose(configText);
  const drop = obj => {
    if (obj && typeof obj === 'object') for (const name of remove) delete obj[name];
  };
  drop(config.mcpServers);
  drop(config.servers);
  drop(config.mcp?.servers);
  if (config.projects) for (const p of Object.values(config.projects)) drop(p?.mcpServers);
  if (!config.mcpServers && !config.servers && !config.mcp && !config.projects) drop(config);
  return JSON.stringify(config, null, 2) + '\n';
}
