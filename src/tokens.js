import { getEncoding } from 'js-tiktoken';

let enc;

/**
 * Estimated tokens a tool definition adds to every turn.
 * Claude's tokenizer is not public, so this uses cl100k_base as a close estimate.
 */
export function toolTokens(tool) {
  enc ||= getEncoding('cl100k_base');
  const def = {
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.inputSchema || tool.input_schema || {},
  };
  return enc.encode(JSON.stringify(def)).length;
}

export function serverTokens(tools) {
  return tools.reduce((sum, t) => sum + toolTokens(t), 0);
}

const WRITE_RE = /(^|_|-|\b)(create|update|delete|remove|write|edit|post|send|push|merge|drop|insert|upsert|move|rename|exec|execute|run|deploy|publish|archive|close|set|add|patch|put|destroy|kill|revoke)(_|-|\b|[A-Z]|$)/i;

// Reads that happen to contain a write verb, e.g. Notion's API-post-search or get_pull_request.
const READ_RE = /(^|_|-|\b)(search|query|get|list|read|fetch|find|view|describe)(_|-|\b|[A-Z]|$)/i;

export function isWriteTool(name) {
  return WRITE_RE.test(name) && !READ_RE.test(name);
}
