/**
 * Compatibility fixes the proxy applies to tools/list results so every server works in every
 * client. Each fix changes as little as possible and can be turned off in Settings.
 * To add one: give it an id, a name and description for Settings, `apply(tools)` that edits the
 * tool list in place and returns how many things it changed, and `note(count, servers)` for the
 * dashboard.
 */
export const FIXES = [
  {
    id: 'schema-dialect',
    name: 'Remove $schema from tool schemas',
    description: 'Claude Desktop rejects tool schemas that declare a JSON Schema dialect such as draft-07. Removes only the top-level $schema line of each input and output schema.',
    defaultOn: true,
    apply(tools) {
      let fixed = 0;
      for (const t of tools) {
        for (const key of ['inputSchema', 'outputSchema']) {
          const schema = t && t[key];
          if (schema && typeof schema === 'object' && '$schema' in schema) {
            delete schema.$schema;
            fixed++;
          }
        }
      }
      return fixed;
    },
    note: (count, servers) => `Removed $schema from ${count} tool schema${count === 1 ? '' : 's'} for ${servers.join(', ')}`,
  },
];

/** Whether a fix is on. Settings keep { compat: { [id]: boolean } }; older installs had one compatFixes switch. */
export function fixEnabled(fix, settings) {
  const own = settings.compat && settings.compat[fix.id];
  if (typeof own === 'boolean') return own;
  if (settings.compatFixes === false) return false;
  return fix.defaultOn;
}

/** Apply every enabled fix to a tools/list result. Returns [{ id, fixed }] for fixes that changed something. */
export function applyFixes(tools, settings) {
  const done = [];
  for (const fix of FIXES) {
    if (!fixEnabled(fix, settings)) continue;
    const fixed = fix.apply(tools);
    if (fixed) done.push({ id: fix.id, fixed });
  }
  return done;
}

export function fixList(settings) {
  return FIXES.map(f => ({ id: f.id, name: f.name, description: f.description, enabled: fixEnabled(f, settings) }));
}
