#!/usr/bin/env node
// Minimal stdio MCP server for tests.
import { lineReader, tryParse } from '../src/lines.js';

const tools = [
  { name: 'search', description: 'Search things', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  { name: 'read_item', description: 'Read one item by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'delete_item', description: 'Delete an item permanently', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'fail', description: 'Always errors', inputSchema: { type: 'object' } },
];
// FAKE_SCHEMA=draft-07 makes every schema declare its dialect, like the reference servers do.
if (process.env.FAKE_SCHEMA) {
  const dialect = process.env.FAKE_SCHEMA === 'draft-07' ? 'http://json-schema.org/draft-07/schema#' : process.env.FAKE_SCHEMA;
  for (const t of tools) t.inputSchema = { $schema: dialect, ...t.inputSchema };
  tools[1].outputSchema = { $schema: dialect, type: 'object', properties: { item: { type: 'string', $schema: 'nested-stays' } } };
}
const out = m => process.stdout.write(JSON.stringify(m) + '\n');

process.stdin.on(
  'data',
  lineReader(line => {
    const m = tryParse(line);
    if (!m || m.id === undefined) return;
    if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
    if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools } });
    if (m.method === 'tools/call') {
      if (m.params.name === 'fail') return out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'nope' }] } });
      return setTimeout(() => out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `ran ${m.params.name}` }] } }), 15);
    }
    out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method' } });
  })
);
