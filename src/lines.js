/** Split a byte stream into newline-delimited lines (MCP stdio framing). */
export function lineReader(onLine) {
  let buf = '';
  return chunk => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  };
}

export function tryParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
