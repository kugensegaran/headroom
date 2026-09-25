import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function home() {
  return process.env.HEADROOM_USER_HOME || os.homedir();
}

export function dataDir() {
  if (process.env.HEADROOM_HOME) return process.env.HEADROOM_HOME;
  if (process.platform === 'darwin') {
    return path.join(home(), 'Library', 'Application Support', 'Headroom');
  }
  return path.join(home(), '.headroom');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const paths = {
  events: () => ensureDir(path.join(dataDir(), 'events')),
  catalog: () => ensureDir(path.join(dataDir(), 'catalog')),
  backups: () => ensureDir(path.join(dataDir(), 'backups')),
  allowlist: () => path.join(ensureDir(dataDir()), 'allowlist.json'),
  settings: () => path.join(ensureDir(dataDir()), 'settings.json'),
  auditStatus: () => path.join(ensureDir(dataDir()), 'audit-status.json'),
};

export function cliPath() {
  return new URL('./cli.js', import.meta.url).pathname;
}
