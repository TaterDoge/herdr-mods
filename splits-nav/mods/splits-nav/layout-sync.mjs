// One shot, also usable while Herdr is closed. The user service invokes this file.
import {
  chmodSync, closeSync, constants, fstatSync, linkSync, lstatSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { layoutPlan, shippedLayouts } from './layouts.js';

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
  if (expected === null && lstatSync(file, { throwIfNoEntry: false })) return;
  const before = snapshot(file);
  if (expected !== null && before?.text !== expected) return;
  const temp = join(dir, '.splits-nav-' + randomUUID());
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, text);
    if (expected === null) {
      // A concurrent Herdr clone (or a symlink at this name) always wins.
      try { linkSync(temp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    } else {
      chmodSync(temp, before.mode);
      // Stage first, then re-read immediately before the atomic replacement.
      if (snapshot(file)?.text === expected) renameSync(temp, file);
    }
  } finally {
    closeSync(fd);
    try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function syncLayouts(appDir) {
  const dir = join(appDir, 'layouts');
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
  if (!snapshot(join(appDir, 'mods', 'splits-nav', 'mod.json'))) return;
  // The job can fire mid-upgrade, before Herdr has published its list of owned files.
  const ledger = snapshot(join(appDir, 'installed.json'))?.text;
  if (!ledger) return;
  let owned;
  try { owned = Object.keys(JSON.parse(ledger)); } catch { return; }
  if (!owned.some(key => key.startsWith('layout:'))) return;
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && !f.name.startsWith('.') && f.name.endsWith('.json'))
    .map(f => ({ name: f.name.slice(0, -5), text: snapshot(join(dir, f.name))?.text ?? null }));
  for (const write of layoutPlan(files, shippedLayouts(ledger))) {
    try { apply(dir, write); } catch (error) {
      console.error(`${write.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

syncLayouts(process.argv[2]);
