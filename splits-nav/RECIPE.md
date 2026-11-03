# Splits Nav

`ctrl+h/j/k/l` moves between panes, `alt+h/j/k/l` resizes them. Inside nvim the same keys mean
"switch/resize the nvim window first, and only touch the herdr pane once it fills the terminal".
Ships with a settings dialog for rebinding.

[中文](RECIPE.zh-CN.md)

![Splits Nav](preview.png)

## What you see

Nothing at all, normally: mounted in a tray/layout it is this 0×0 block (`"place": "none"`) that only
captures keys. Pressing the settings key (default `cmd-shift-s`) opens a 560px wide dialog
(`overlay.dialog`), `popover` background, padding 18, row gap 10:

- Title row: "Splits Nav" on the left (15px semibold), "Esc" on the right (11px dim).
- One 11px dim hint line: "Click a key then press the key you want (Esc cancels): only ctrl/alt/shift
  plus one letter, digit or arrow key, and ctrl or alt is required (the row that opens settings also
  accepts cmd). Direction/resize keys must convert to nvim notation; conflicts are judged by `keys()`,
  the terminal section wins over global."
- Nine rows (4 directions + 4 resizes + settings): a 64px wide 12px dim label on the left, a 26px
  tall rounded-6 key button in the middle (12px medium; idle it shows the current key + `▾`, while
  recording it shows "press a key…", and on conflict its border and text use `blocked` red), and an
  11px explanation on the right ("available", a conflict list, or the recording hint in `muted` or
  red).
- Two 32px tall, rounded-8 buttons right-aligned at the bottom: Apply (`solid`) and Close (`raised`).
- A final 18px tall 11px status line: success `done` green, failure `blocked` red.

## Behaviour

- Focused pane is an ordinary program (shell, agent…) → move the pane; if zoomed, un-zoom first; with
  no neighbour, wrap around.
- Focused pane is nvim → go over TCP and let the nvim plugin switch its own window; only when nvim
  answers `edge` does it fall back to moving the pane. No terminal byte injection; if nvim is
  unreachable it silently degrades to moving the pane.
- Resize (`alt+h/j/k/l`): inside nvim it first resizes nvim's own split (3 columns per press, the ±
  sign derived from the window's position in the layout, same as herdr-splits.nvim), and only when
  nvim has no neighbour on that side (answers `edge`) does it resize the herdr pane; an ordinary pane
  resizes the herdr pane directly.
  A herdr pane's size can only move through `run("layout.resize")` (the app has no pane.resize
  command; a pane is a runtime layout node and its id is the pane id): first `pane.go` probes whether
  a neighbour exists in that direction / the opposite one (returning focus afterwards) to decide
  grow vs shrink, then `hc get <terminal>` reads both sides' cell counts as weights (3% per cell) and
  both panes' weights are rewritten.
  Direction semantics follow the reference implementation: if the border on that side gives space to
  you, you grow; if it squeezes you, you shrink; with no neighbour nothing happens.
- The settings key (default `cmd+shift+s`) opens the dialog to change the 8 direction/resize keys and
  the settings key itself: click a row's key button to start recording, then press the new key (Esc
  cancels; only ctrl/alt/shift plus one letter, digit or arrow key, and ctrl or alt is required; the
  row that opens settings also accepts cmd). Conflicts are checked, and Apply writes `keys.json`.
- Mounting: a mod only runs where "the layout mounts it", and its commands only reach the live copy
  in the current layout. So init adds a 0×0 floating block to every personal layout; herdr's shipped
  layouts are rewritten on every start (writing to them turns them into `<name>-edited` and they get
  rebuilt repeatedly), so for the two in `COPY_FOR` — Herdr (`main`) and Terminals — it keeps one
  `<name>-nav` copy each (skipped if a clone already exists or the copy exists); herdr's other
  shipped layouts (Herdr 98 etc.) are left alone (they drive themselves by clicks and won't use these
  keys).

## Install

1. Use `scripts/link` at the repo root, or copy this folder's `mods/splits-nav/` to
   `~/.config/herdr-app/mods/splits-nav/`. Hot reload only trusts real folders; a symlink does not
   take effect.
2. Merge this folder's `keys.json` `global` section into the user's `keys.json`, or just hit Apply in
   the dialog.
3. nvim half: **configured automatically**. The first time the mod loads in a real app window (the
   block is mounted in a layout — not during `herdr-app check`, and not when Customize copies files),
   it runs `link-nvim` once: symlinking `nvim/plugin/herdr-nav.lua` into `~/.config/nvim/plugin` and
   telling you to restart nvim. It does not add a lazy.nvim entry and does not edit your nvim config:
   the symlink resolves back into `nvim/` and adds itself to the runtimepath. The plugin only starts
   inside a herdr terminal (it needs `HC_TERMINAL_ID`) and is a no-op outside one. It does not nag
   again when a valid link already exists; a broken link is repaired automatically; if an ordinary
   file is in the way it exits with an error and you must remove that file and reload. The default
   location is `~/.config/nvim/plugin`, overridable with `NVIM_PLUGIN_DIR`. After updating the mod,
   restart your running nvim to pick up the new version. Auto-setup needs POSIX sh; without it setup
   fails and you must run `link-nvim` by hand. It assumes the nvim config lives at `~/.config/nvim`;
   on Windows or with a custom `XDG_CONFIG_HOME`, set `NVIM_PLUGIN_DIR` or nvim may never read that
   directory.
4. Layout: **mounted automatically**. The first time the mod loads in a real window (not
   `herdr-app check`) it scans `layouts/*.json`: any layout not mounting it gets a floating block
   added (`layoutPlan`). Herdr's shipped layouts (recognised from its ledger `installed.json` entries
   named `layout:<name>`, plus the three currently known names as a fallback) are **never written** —
   they are rewritten wholesale on every start, and writing to them moves them to `<name>-edited`
   where they get rebuilt endlessly; instead it creates a one-off `<name>-nav` copy for each entry in
   `COPY_FOR` (Herdr `main` + Terminals), and only when no other layout points at it via
   `cloned_from`. Herdr 98 gets no compatibility shim (it drives itself by clicks and won't use these
   keys).
   Idempotent: layouts that are already mounted are not touched byte for byte, and a copy is never
   created twice; creating one notifies once.
   Switch to those two copies (the Herdr one / the Terminals one) to use the keys (the shipped
   originals themselves cannot be changed: Herdr/Terminals go through copies, Herdr 98 is
   unsupported).

## How it is built

- `main.js`: a `View` subclass. With no panel open `render()` returns `div().w(0).h(0)`;
  `nextCommand()` loops over `left`/`right`/`up`/`down`/`settings`/`probe`/`probe-geometry`, and only
  the mounted copy listens (a second copy would steal commands).
  The mounted copy's init also runs `autoInstallLinkNvim()`: when `window()` is non-empty (a real
  window, not check), run `link-nvim` via `exec("sh", [script])`; only notify about the nvim restart
  when something changed, report errors, and never block keys. `install.js` is host-free pure
  orchestration (unit-testable by passing a fake exec), and the notification texts live there too.
  The same place also runs `plantLayouts()`: read `layouts/*.json`, hand them to `layoutPlan` to
  decide what to write (personal layouts missing a mount get a floating in place; shipped layouts in
  `COPY_FOR` get a `<name>-nav` copy) and call `writeTextFile` with the text read earlier as
  concurrency protection; if there is nothing to write, not a single byte is written. Both run once
  only and report a failure only once.
- `layouts.js`: host-free pure functions — `MOUNT` (that 0×0 floating block), `SHIPPED` (fallback
  name list), `shippedLayouts` (reads `layout:<name>` from the ledger json), `hasMount` (mounted
  anywhere in the tree counts, whether as a block or a float), `injectMount` (returns null when
  already present, throws on non-JSON), `layoutPlan` (the files to write and their expected text; an
  empty array means nothing to do). The selftest drives these directly.
- `nav.js`: side-effect-free pure functions — key parsing (`ctrl/alt/shift` combinations),
  `mergeKeys` for merging keys.json, discovery file paths and validation, request encoding / response
  decoding, `NavQueue` (one queue per terminal; drops when full or past `NAV_PRESS_TTL_MS` 2000ms).
- Imports: `gpui-kit` (`View`, `div`), `gpui-base` (`v_flex`, `h_flex`),
  `herdr` (`appHome`, `closeOverlay`, `exec`, `focused`, `keys`, `nextCommand`, `notify`,
  `openOverlay`, `panes`, `props`, `readTextFile`, `run`, `setShared`, `shared`, `theme`, `window`,
  `writeTextFile`), `net`, `fs/promises`, plus `./nav.js`, `./install.js`, `./layouts.js` from the
  same folder. No other mod is imported, there are no third-party dependencies, and there is no
  build.
- Commands used: `run("pane.go", { direction })` to move a pane, `run("pane.zoom")` to un-zoom,
  `run("pane.focus")`; resize uses `run("layout.resize", { id, weight })` to rewrite weights by pane
  id, after reading cell counts with `exec("hc", ["get", terminal])`; the panel uses
  `openOverlay`/`closeOverlay`.
- nvim half: `nvim/plugin/herdr-nav.lua` starts `nvim/lua/herdr-nav/server.lua` when `HC_TERMINAL_ID`
  exists, listens on 127.0.0.1, and writes port/pid into
  `appHome()/splits-nav/nvim-<terminal>.json`; each request switches its own window first and answers
  `edge` at the boundary, only then does the mod move the pane.
- `nvim/plugin/herdr-nav.lua` is symlinked into `~/.config/nvim/plugin` (or `NVIM_PLUGIN_DIR`) by
  `link-nvim`, not through any package manager; this unit has no `plugin/` shim either.
- `preview.png` is a real screenshot of the settings dialog.

## Cautions

- **Touches the network, files, and runs a script**: `net.connect("127.0.0.1", port)` to reach nvim;
  reads discovery files; Apply reads and rewrites `appHome()/keys.json` (in place, no backup); `probe`
  writes `appHome()/splits-nav-probe.json`; mounting reads and rewrites `appHome()/layouts/*.json`
  (only personal layouts missing a mount, plus newly created `<name>-nav`, with the original text as
  concurrency protection). The first real load executes POSIX sh (`sh link-nvim`): it creates the
  target parent directory if needed and creates/repairs the symlink outside the target directory; it
  reads and writes no files outside that target symlink and its parent directory. Auto-setup fails
  without POSIX sh. Reading cell counts runs `hc get <terminal>` (herdr-core's CLI).
- Symlinking into `~/.config/herdr-app/mods/` does **not** hot reload; after edits, copy into a real
  folder or restart the app, and `status` won't warn you either.
- Missing either half of nvim/keys.json reports no error, it just silently degrades to "move the
  pane", which very easily looks like breakage; requests from nvim time out after 10s (they wait
  while you are busy in a long command) and only then degrade.
- `ctrl+h/j/k/l` have their own meanings in nvim; installing this takes them over. `terminal` section
  bindings win over `global`, so don't bind the same key in both sections — conflict checking uses the
  effective `keys()` result.
- Hand-written splits-nav bindings of `shift-<single letter or digit>` (accepted by older `isChord`)
  are no longer valid chords: the panel shows the default key and the nvim side receives the default
  key too, and the next Apply deletes that hand-written binding.
- While recording, the panel mutes the mod's command loop through `shared("splits-nav.recording")`
  (so the key being recorded can't also fire the old action); if the panel disappears without
  cleanup (light dismiss, hot reload, layout switch), muting lasts at most `RECORDING_TTL_MS`, after
  which the first command self-heals and runs as usual.
- Probing neighbours during resize briefly does `pane.go` then `pane.focus` to restore (a few frames),
  so a held key visibly jitters the focus; with no neighbour on that side nothing happens. Reading
  sizes depends on `hc` being on PATH (herdr-core's CLI); if it can't be read, that reshape is given
  up.
- Mount injection rewrites that JSON file (`JSON.parse`→`stringify`), so numbers like `120.0` become
  `120`; the tree itself is unchanged. It only writes files that genuinely miss a mount — already
  mounted ones are not touched byte for byte. Herdr's shipped layouts (the `layout:<name>` entries in
  the ledger `installed.json`) are never written: writing to them moves them to `<name>-edited` and
  they get rebuilt on every start; among them `COPY_FOR` (Herdr/Terminals) each get one `<name>-nav`
  copy, other shipped layouts (Herdr 98) are left alone (the app may rewrite the copies itself, which
  preserves the mount).
- **"Default mods work everywhere" is not achieved by injection**: there are 23 mods on disk and the
  three shipped layouts reference only 8/2/1 of them; 11 (`picker`/`help`/`confirm`/`prompt`/`toast`/
  `menu`/`new-menu`/`peek`/`machine-add`/`worktree`/`herdr-customize`) are referenced by **no layout
  at all**. They work because **the app opens them by name** (keys are bound to app commands, e.g.
  `cmd-p`→`mod.open:picker`, `cmd-/`→`app.help`), popping their dialogs over the current layout.
  A mod's own keyboard commands `<mod>.<command>` only reach "the live copy in the current layout",
  so a purely keyboard-driven mod like splits-nav needs one mount per layout.
- **All injections are idempotent**: layout mounting (`layoutPlan`), the `link-nvim` symlink, and
  Apply writing keys.json give the same result when repeated, and write nothing when nothing changed
  (the selftest pins each case, including the second run returning an empty plan).

## Done criteria

- `herdr-app check mods/splits-nav` exits 0.
- `node mods/splits-nav/selftest.mjs` prints `all passed` on the last line (key parsing, JSON round
  trip, lua conversion, discovery file validation, request/response, layout mounting and idempotence).
- `node mods/splits-nav/selftest-install.mjs` prints `all passed` on the last line (a real link-nvim
  install in isolation, repeated runs, broken symlink repair, conflict protection, and the auto-run
  orchestration).
- The settings key opens the dialog with all nine rows; changing one key and hitting Apply writes
  `keys.json`.
- In nvim, `ctrl+h` switches the nvim window first and only moves the herdr pane at the leftmost
  window; without nvim running the key moves the pane directly.
- Clicking a row's button shows "press a key…", pressing a valid key shows the new chord on that row,
  and Esc cancels back to the original chord; an invalid key (pressing `cmd-shift-s` on a
  direction/resize row, `escape` on the settings row) shows the rejection reason inside that row and
  stays in recording.
- While recording, arrow keys do not actually move the pane; the new chord only takes over after
  Apply.
- With an nvim split open, `alt+l` resizes the nvim split; with a single full-window nvim, `alt+l`
  resizes the herdr pane; in an ordinary pane `alt+l` resizes the herdr pane directly.

## Files written

- `~/.config/herdr-app/splits-nav/nvim-<terminal>.json` — the nvim plugin's discovery file (port/pid).
- `~/.config/nvim/plugin/herdr-nav.lua` — the symlink created by `link-nvim` (default
  `~/.config/nvim/plugin`, overridable with `NVIM_PLUGIN_DIR`).
- `~/.config/herdr-app/keys.json` — rewritten in place by Apply (no backup).
- `~/.config/herdr-app/splits-nav-probe.json` — diagnostic snapshot from `splits-nav.probe`.
- `~/.config/herdr-app/layouts/<name>.json` — personal layouts missing a mount (one floating block
  added in place).
- `~/.config/herdr-app/layouts/<name>-nav.json` — personal copies of the Herdr shipped layouts in
  `COPY_FOR` (the shipped files themselves are never written), created once.
