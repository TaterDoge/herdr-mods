// Checks the layout rules and the one-shot repair without Herdr running.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'mods/nvim-palette');
const profile = mkdtempSync(join(tmpdir(), 'nvim-palette '));
const dir = join(profile, 'layouts');
const mod = join(profile, 'mods/nvim-palette');
const sync = () => execFileSync(process.execPath, [join(mod, 'layout-sync.mjs'), profile]);
const raw = name => readFileSync(join(dir, name), 'utf8');
const layout = { id: 'root', type: 'column', children: [], floating: [{ id: 'usage', content: { mod: 'usage' } }] };
const original = JSON.stringify(layout);
const put = (name, text) => writeFileSync(join(dir, name), text);
const mounted = name => {
  const value = JSON.parse(raw(name));
  const ours = value.floating?.filter(f => f.content?.mod === 'nvim-palette') ?? [];
  assert.equal(ours.length, 1);
  value.floating = value.floating.filter(f => f !== ours[0]);
  assert.deepEqual(value, JSON.parse(original));
};

try {
  mkdirSync(dir, { recursive: true });
  mkdirSync(mod, { recursive: true });
  for (const f of ['layout-sync.mjs', 'layouts.js', 'mod.json']) {
    copyFileSync(join(source, f), join(mod, f));
  }
  put('omarchy.json', original);
  put('main.json', original);
  put('broken.json', '{');
  put('metadata.json', '{"version":1}');
  const external = join(profile, 'external.json');
  writeFileSync(external, original);
  symlinkSync(external, join(dir, 'symlink.json'));

  sync();
  assert.equal(raw('omarchy.json'), original, 'wait for the ownership ledger');

  writeFileSync(join(profile, 'installed.json'), '{"layout:main":{}}');
  sync();
  mounted('omarchy.json');
  for (const name of ['main.json', 'broken.json', 'metadata.json', 'symlink.json']) {
    assert.equal(raw(name), name === 'broken.json' ? '{' : name === 'metadata.json' ? '{"version":1}' : original, name);
  }
  assert.equal(readFileSync(external, 'utf8'), original);

  const stamp = () => statSync(join(dir, 'omarchy.json'), { bigint: true }).mtimeNs;
  const first = stamp();
  sync();
  assert.equal(stamp(), first, 'an existing mount costs no write');

  // An updater replaces the layout, dropping the mount and adding new data.
  const update = { ...layout, theme: 'paper', floating: [{ id: 'nvim-palette', content: { mod: 'files' } }] };
  const incoming = join(profile, 'incoming.json');
  writeFileSync(incoming, JSON.stringify(update));
  renameSync(incoming, join(dir, 'omarchy.json'));
  sync();
  const repaired = JSON.parse(raw('omarchy.json'));
  assert.equal(repaired.theme, 'paper');
  assert.equal(repaired.floating.at(-1).id, 'nvim-palette-2');

  console.log('nvim-palette layout selftest passed');
} finally {
  rmSync(profile, { recursive: true, force: true });
}