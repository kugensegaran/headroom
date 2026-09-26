import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ensureDir, paths } from './paths.js';
import { setSettings } from './store.js';

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 30;
const DAY = 86400000;

function file() {
  return path.join(ensureDir(dataDir()), 'license.json');
}

export function readLicense() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Written by the Mac app after it talks to the licence server (the key itself stays in the
 * Keychain). Fields: status ('active' | 'none'), validatedAt, updatesUntil, email.
 */
export function writeLicense(patch) {
  const next = { ...readLicense(), ...patch };
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file());
  return next;
}

/** Start the trial clock the first time Headroom runs. */
export function ensureTrialStarted(now = Date.now()) {
  const l = readLicense();
  if (l.trialStart) return;
  // A brand new install: start with write and delete tools off. Existing installs keep everything on.
  if (!fs.existsSync(paths.settings())) setSettings({ writeToolsOff: true });
  writeLicense({ trialStart: now });
}

/**
 * What the user may do right now. A validated licence stays good offline for GRACE_DAYS.
 * mode: 'licensed' | 'trial' | 'expired' | 'recheck' (licence not validated for too long)
 */
export function licenseState(now = Date.now()) {
  const l = readLicense();
  const trialStart = l.trialStart || now;
  const trialEnds = trialStart + TRIAL_DAYS * DAY;
  const base = { trialEnds, updatesUntil: l.updatesUntil || null, email: l.email || null };
  if (l.status === 'active') {
    if (l.validatedAt && now - l.validatedAt <= GRACE_DAYS * DAY) return { ...base, licensed: true, mode: 'licensed' };
    return { ...base, licensed: now < trialEnds, mode: 'recheck' };
  }
  if (now < trialEnds) return { ...base, licensed: true, mode: 'trial', daysLeft: Math.ceil((trialEnds - now) / DAY) };
  return { ...base, licensed: false, mode: 'expired' };
}

let cached = { at: 0, value: null };
/** licenseState() re-read at most once a minute, for hot paths like the proxy. */
export function isLicensed(now = Date.now()) {
  if (!cached.value || now - cached.at > 60000) cached = { at: now, value: licenseState(now).licensed };
  return cached.value;
}

export const NEEDS_LICENCE = 'Your Headroom trial has ended. Audit and the dashboard still work; add a licence in the menu bar app to turn this back on.';
