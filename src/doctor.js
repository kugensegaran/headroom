import fs from 'node:fs';
import path from 'node:path';
import { getAt, knownClients, readClientConfig, serverBlocks } from './clients.js';
import { backupConfig, isWrapped, unwrap } from './install.js';
import { cliPath, dataDir, ensureDir, nodePath } from './paths.js';

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Find a bare command the way a client would, on PATH. */
export function onPath(command, envPath = process.env.PATH || '') {
  if (command.includes('/')) return executable(command) ? command : null;
  for (const dir of envPath.split(path.delimiter)) {
    if (dir && executable(path.join(dir, command))) return path.join(dir, command);
  }
  return null;
}

/**
 * Check that Headroom's own wiring still works: Node, the data folder, every client
 * config, and every wrapped entry. With fix, repoint wrapped entries at this Node
 * and this cli.js (after a backup), which is what breaks when the app moves or Node upgrades.
 */
export function runDoctor({ fix = false } = {}) {
  const checks = [];
  const add = (level, message, extra = {}) => checks.push({ level, message, ...extra });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20 ? 'ok' : 'error', `Node ${process.versions.node} at ${process.execPath}${major >= 20 ? '' : ' (needs 20 or newer)'}`);

  try {
    ensureDir(dataDir());
    fs.accessSync(dataDir(), fs.constants.W_OK);
    add('ok', `Data folder ${dataDir()}`);
  } catch (err) {
    add('error', `Data folder ${dataDir()} is not writable: ${err.message}`);
  }

  const cli = cliPath();
  for (const client of knownClients()) {
    const cfg = readClientConfig(client);
    if (!cfg) {
      add('ok', `${client.label}: no config at ${client.file}`);
      continue;
    }
    if (cfg.__error) {
      add('error', `${client.label}: ${cfg.__error}. Backups are in ${path.join(dataDir(), 'backups')}.`);
      continue;
    }
    let changed = 0;
    let wrappedCount = 0;
    for (const block of serverBlocks(client, cfg)) {
      const servers = getAt(cfg, block.path);
      if (!servers || typeof servers !== 'object') continue;
      for (const [name, entry] of Object.entries(servers)) {
        if (!entry || typeof entry !== 'object' || !isWrapped(entry)) continue;
        wrappedCount++;
        const problems = [];
        if (!executable(entry.command)) problems.push(`Node is missing at ${entry.command}`);
        if (!fs.existsSync(entry.args[0])) problems.push(`Headroom is missing at ${entry.args[0]}`);
        const stable = nodePath(entry.command);
        if (!problems.length && stable !== entry.command) {
          if (fix) {
            servers[name] = { ...entry, command: stable };
            changed++;
          }
          add(fix ? 'fixed' : 'warn', `${client.label} ${name}: Node path ${entry.command} changes on every Homebrew upgrade${fix ? `. Now ${stable}.` : '. Run `headroom doctor --fix`.'}`);
        }
        if (problems.length) {
          if (fix) {
            servers[name] = { ...entry, command: nodePath(), args: [cli, ...entry.args.slice(1)] };
            changed++;
          }
          add(fix ? 'fixed' : 'error', `${client.label} ${name}: ${problems.join('; ')}${fix ? '. Pointed it at this install.' : '. Run `headroom doctor --fix`.'}`);
        }
        const original = unwrap(entry);
        if (original.command && !onPath(original.command)) {
          add('warn', `${client.label} ${name}: "${original.command}" is not on PATH here. If the client cannot start it either, use the full path in the config.`);
        }
      }
    }
    let backup = null;
    if (changed) {
      backup = backupConfig(client);
      fs.writeFileSync(client.file, JSON.stringify(cfg, null, 2) + '\n');
    }
    add('ok', `${client.label}: ${client.file}, ${wrappedCount} server${wrappedCount === 1 ? '' : 's'} through Headroom`, backup ? { backup } : {});
  }
  return checks;
}
