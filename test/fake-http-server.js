// Minimal streamable HTTP MCP server for tests.
import http from 'node:http';

export const TOKEN = 't0ken-secret-value';
const tools = [
  { name: 'lookup', description: 'Look something up', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  { name: 'send_message', description: 'Send a message', inputSchema: { type: 'object', properties: { to: { type: 'string' } } } },
];

export function startFakeHttp() {
  const seen = { deletes: 0, sessionsMissing: 0 };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/oauth' || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' });
      return res.end();
    }
    if (req.method === 'GET') {
      res.writeHead(405);
      return res.end();
    }
    if (req.method === 'DELETE') {
      seen.deletes++;
      res.writeHead(200);
      return res.end();
    }
    let raw = '';
    for await (const c of req) raw += c;
    const m = JSON.parse(raw);
    if (m.method !== 'initialize' && req.headers['mcp-session-id'] !== 'sess-1') seen.sessionsMissing++;
    if (m.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    const reply = result => JSON.stringify({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
      return res.end(reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-http', version: '1' } }));
    }
    if (m.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(reply({ tools }));
    }
    if (m.method === 'tools/call') {
      // Answer as an event stream with a progress notification first, like real servers do.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
      await new Promise(r => setTimeout(r, 15));
      return res.end(`event: message\ndata: ${reply({ content: [{ type: 'text', text: `remote ran ${m.params.name}` }] })}\n\n`);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method' } }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}
