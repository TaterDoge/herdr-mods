// One shot, also usable while Herdr is closed. The user service invokes this file.
import {
  chmodSync, closeSync, constants, fstatSync, linkSync, lstatSync, openSync, readFileSync,
  readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { layoutPlan, shippedLayouts } from './layouts.js';

const LOCK = '.layout-sync.lock';
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 2_000;
const ATTEMPTS = 3;

function snapshot(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    return stat.isFile() ? { text: readFileSync(fd, 'utf8'), mode: stat.mode & 0o777 } : null;
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EACCES'].includes(error.code)) return null;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function apply(dir, { name, text, expected }) {
  const file = join(dir, name + '.json');
  if (expected === null && lstatSync(file, { throwIfNoEntry: false })) return false;
  const before = snapshot(file);
  if (expected !== null && before?.text !== expected) return false;
  const temp = join(dir, '.splits-nav-' + randomUUID());
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, text);
    if (expected === null) {
      // A concurrent Herdr clone (or a symlink at this name) always wins.
      try { linkSync(temp, file); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return false;
      }
    } else {
      chmodSync(temp, before.mode);
      // Stage first, then re-read immediately before the atomic replacement.
      if (snapshot(file)?.text !== expected) return false;
      renameSync(temp, file);
    }
    return true;
  } finally {
    closeSync(fd);
    try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// The nvim-palette worker uses the same lock: both edit layouts/, and a rename
// after another worker's rename would lose that worker's mount.
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(appDir) {
  const path = join(appDir, LOCK);
  const started = Date.now();
  for (;;) {
    let fd;
    try {
      fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return path;
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      if (error.code !== 'EEXIST') {
        try { unlinkSync(path); } catch {}
        throw error;
      }
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= LOCK_WAIT_MS) throw new Error('another layout sync holds the lock');
      pause(25);
    }
  }
}

function release(path) {
  try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function syncOnce(appDir) {
  const dir = join(appDir, 'layouts');
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return { retry: false, failed: false };
  if (!snapshot(join(appDir, 'mods', 'splits-nav', 'mod.json'))) return { retry: false, failed: false };
  // The job can fire mid-upgrade, before Herdr has published its list of owned files.
  const ledger = snapshot(join(appDir, 'installed.json'))?.text;
  if (!ledger) return { retry: true, failed: false };
  let owned;
  try { owned = Object.keys(JSON.parse(ledger)); } catch { return { retry: true, failed: false }; }
  if (!owned.some(key => key.startsWith('layout:'))) return { retry: true, failed: false };
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && !f.name.startsWith('.') && f.name.endsWith('.json'))
    .map(f => ({ name: f.name.slice(0, -5), text: snapshot(join(dir, f.name))?.text ?? null }));
  let failed = false;
  let changed = false;
  for (const write of layoutPlan(files, shippedLayouts(ledger))) {
    try {
      if (!apply(dir, write)) changed = true;
    } catch (error) {
      failed = true;
      console.error(`${write.name}: ${error.message}`);
    }
  }
  return { retry: failed || changed, failed };
}

async function main(appDir) {
  let failed = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const lock = acquire(appDir);
    let result;
    try {
      result = syncOnce(appDir);
    } finally {
      release(lock);
    }
    failed = result.failed;
    if (!result.retry) return failed;
    if (attempt + 1 < ATTEMPTS) await delay(200 * (attempt + 1));
  }
  console.error('layouts: another change or a missing Herdr ledger kept the sync from settling; the next change retries');
  return failed;
}

try {
  if (await main(process.argv[2])) process.exitCode = 1;
} catch (error) {
  console.error('layout-sync: ' + error.message);
  process.exitCode = 1;
}
