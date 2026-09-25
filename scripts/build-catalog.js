#!/usr/bin/env node
// Measure well-known MCP servers with Headroom's own audit and write site/catalog.json,
// which the website's free audit uses to look up servers from a pasted config.
// Only servers that answered are written, with the date they were measured.
//   node scripts/build-catalog.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-catalog-'));
process.env.HEADROOM_HOME = path.join(scratch, 'data');
process.env.HEADROOM_USER_HOME = path.join(scratch, 'home');
const { listToolsHttp, listToolsStdio } = await import('../src/mcpclient.js');
const { toolTokens, isWriteTool } = await import('../src/tokens.js');

const npx = pkg => ({ command: 'npx', args: ['-y', pkg] });
// match: npm package names and URL hosts that identify the server in someone's config.
const SERVERS = [
  { id: 'filesystem', name: 'Filesystem', entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', scratch] }, match: ['@modelcontextprotocol/server-filesystem'] },
  { id: 'memory', name: 'Memory', entry: npx('@modelcontextprotocol/server-memory'), match: ['@modelcontextprotocol/server-memory'] },
  { id: 'sequential-thinking', name: 'Sequential Thinking', entry: npx('@modelcontextprotocol/server-sequential-thinking'), match: ['@modelcontextprotocol/server-sequential-thinking'] },
  { id: 'everything', name: 'Everything (reference)', entry: npx('@modelcontextprotocol/server-everything'), match: ['@modelcontextprotocol/server-everything'] },
  { id: 'playwright', name: 'Playwright', entry: npx('@playwright/mcp@latest'), match: ['@playwright/mcp'] },
  { id: 'context7', name: 'Context7', entry: npx('@upstash/context7-mcp'), match: ['@upstash/context7-mcp', 'mcp.context7.com'] },
  { id: 'chrome-devtools', name: 'Chrome DevTools', entry: npx('chrome-devtools-mcp@latest'), match: ['chrome-devtools-mcp'] },
  { id: 'github', name: 'GitHub (reference npm server)', entry: { ...npx('@modelcontextprotocol/server-github'), env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'catalog-placeholder' } }, match: ['@modelcontextprotocol/server-github'] },
  { id: 'notion', name: 'Notion', entry: { ...npx('@notionhq/notion-mcp-server'), env: { NOTION_TOKEN: 'catalog-placeholder' } }, match: ['@notionhq/notion-mcp-server'] },
  { id: 'deepwiki', name: 'DeepWiki', entry: { url: 'https://mcp.deepwiki.com/mcp' }, match: ['mcp.deepwiki.com'] },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', entry: { url: 'https://docs.mcp.cloudflare.com/mcp' }, match: ['docs.mcp.cloudflare.com'] },
];

const out = { measured: new Date().toISOString().slice(0, 10), tokenizer: 'cl100k_base estimate', servers: [] };
for (const s of SERVERS) {
  process.stderr.write(`${s.id}... `);
  try {
    const res = s.entry.url ? await listToolsHttp(s.entry, { timeoutMs: 30000 }) : await listToolsStdio(s.entry, { timeoutMs: 120000 });
    const tools = res.tools.map(t => ({ name: t.name, tokens: toolTokens(t), write: isWriteTool(t.name) }));
    out.servers.push({ id: s.id, name: s.name, match: s.match, version: res.serverInfo?.version || null, tools });
    process.stderr.write(`${tools.length} tools, ${tools.reduce((a, t) => a + t.tokens, 0)} tokens\n`);
  } catch (err) {
    process.stderr.write(`skipped: ${err.message.split('\n')[0].slice(0, 120)}\n`);
  }
}
const dest = new URL('../site/catalog.json', import.meta.url);
fs.mkdirSync(new URL('.', dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
fs.rmSync(scratch, { recursive: true, force: true });
console.log(`Wrote ${out.servers.length} servers to site/catalog.json`);
