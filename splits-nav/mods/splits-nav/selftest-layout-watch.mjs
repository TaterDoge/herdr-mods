// --service additionally installs and removes a real user job for this temporary profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = mkdtempSync(join(tmpdir(), 'splits-nav $ & % 布局-'));
const dir = join(profile, 'layouts');
const mod = join(profile, 'mods/splits-nav');
const service = process.argv.includes('--service');
const run = (file, ...args) => execFileSync(process.execPath, [join(mod, file), ...args], {
  env: { ...process.env, HERDR_APP_HOME: profile }, stdio: 'pipe',
});
const watch = action => run('layout-watch.mjs', action);
const raw = name => readFileSync(join(dir, name), 'utf8');
const layout = { id: 'root', type: 'column', children: [], floating: [{ id: 'usage', content: { mod: 'usage' } }] };
const original = JSON.stringify(layout);
const put = (name, text) => writeFileSync(join(dir, name), text);
const matches = (name, upstream) => {
  const value = JSON.parse(raw(name));
  const ours = value.floating?.filter(f => f.content?.mod === 'splits-nav') ?? [];
  assert.equal(ours.length, 1);
  value.floating = value.floating.filter(f => f !== ours[0]);
  assert.deepEqual(value, upstream);
};
async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    try { check(); return; } catch { await delay(100); }
  }
  check();
}

try {
  mkdirSync(join(dir, '.state'), { recursive: true });
  mkdirSync(mod, { recursive: true });
  for (const f of ['layout-sync.mjs', 'layout-watch.mjs', 'layouts.js', 'mod.json']) {
    copyFileSync(new URL(f, import.meta.url), join(mod, f));
  }
  put('omarchy.json', original);
  put('main.json', original);
  put('future-stock.json', original);
  put('.state/omarchy.json', original);
  put('.backup.json', original);
  put('broken.json', '{');
  put('metadata.json', '{"version":1}');
  put('bad-float.json', '{"type":"row","floating":{"mine":true}}');
  const external = join(profile, 'external.json');
  writeFileSync(external, original);
  symlinkSync(external, join(dir, 'symlink.json'));
  run('layout-sync.mjs', profile);
  assert.equal(raw('future-stock.json'), original, 'wait for the ownership ledger');
  writeFileSync(join(profile, 'installed.json'), '{"layout:main":{},"layout:future-stock":{}}');
  if (service) watch('install');
  else run('layout-sync.mjs', profile);
  await eventually(() => matches('omarchy.json', layout));
  matches('main-nav.json', layout);
  for (const name of ['main.json', 'future-stock.json', '.state/omarchy.json', '.backup.json', 'symlink.json']) {
    assert.equal(raw(name), original, name);
  }
  assert.equal(raw('broken.json'), '{');
  assert.equal(raw('metadata.json'), '{"version":1}');
  assert.equal(raw('bad-float.json'), '{"type":"row","floating":{"mine":true}}');
  const stamp = () => statSync(join(dir, 'omarchy.json'), { bigint: true }).mtimeNs;
  const first = stamp();
  if (service) watch('install');
  run('layout-sync.mjs', profile);
  assert.equal(stamp(), first, 'an existing mount costs no write');

  // Updater replaces the active layout, dropping the only mount and adding new upstream data.
  const update = { ...layout, theme: 'paper', children: [{ id: 'splits-nav', type: 'block', content: { mod: 'files' } }] };
  const incoming = join(profile, 'incoming.json');
  writeFileSync(incoming, JSON.stringify(update));
  renameSync(incoming, join(dir, 'omarchy.json'));
  if (!service) run('layout-sync.mjs', profile);
  await eventually(() => matches('omarchy.json', update));
  assert.equal(JSON.parse(raw('omarchy.json')).floating.at(-1).id, 'splits-nav-2');
  put('new layout.json', original);
  if (!service) run('layout-sync.mjs', profile);
  await eventually(() => matches('new layout.json', layout));
  put('omarchy.json', '{');
  await delay(service ? 1300 : 0);
  assert.equal(raw('omarchy.json'), '{');
  put('omarchy.json', original);
  if (!service) run('layout-sync.mjs', profile);
  await eventually(() => matches('omarchy.json', layout));
  if (service) {
    watch('uninstall');
    put('omarchy.json', original);
    await delay(1800);
    assert.equal(raw('omarchy.json'), original, 'uninstall stops repairs');
  }
  console.log('all passed' + (service ? ' (real user service)' : ''));
} finally {
  try { if (service) watch('uninstall'); } finally { rmSync(profile, { recursive: true, force: true }); }
}
