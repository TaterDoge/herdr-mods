// Move to the pane beside, or hand the key to nvim like a plain terminal
// would. The chord comes from the binding keys.json gives this command, so
// the dialog and a hand-edited keys.json are the same truth.
//
// One class, two faces: docked in a layout's floating slot it draws nothing
// and takes the key commands; opened as an overlay (props().overlay) it draws
// the panel that edits them. herdr's own pane.go eats the key everywhere;
// this decides per pane, from the program running in it.
//
// nvim panes are asked over TCP: the nvim plugin (mods/splits-nav/nvim)
// listens on 127.0.0.1 and writes a discovery file under appHome()/splits-nav/.
// Each keypress is one connect/ask/read/close, kept in a per-terminal queue so
// presses stay in order and a quick double tap still reaches nvim twice. A
// reachable nvim answers moved/passthrough (handled) or edge (delegate to
// herdrMove). stale/ignore, a missing file or a refused connect count as
// unreachable: re-read once, then herdrMove and notify once. A request that
// stays silent past the budget is abandoned: nvim is stuck, its queued work
// still runs when it frees up, and the next press is fresh.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome, closeOverlay, focused, keys, nextCommand, notify, openOverlay,
  panes, props, readTextFile, run, theme, writeTextFile,
} from "herdr";
import net from "net";
import * as fs from "fs/promises";
import {
  DEFAULT_KEYS, DIRECTIONS, NavQueue, REVERSE_DIRECTIONS, SETTINGS_KEY,
  chordFromJsonChord, chordToLua, decodeResponse, discoveryInfo, discoveryPath,
  encodeRequest, isChord, mergeKeys,
} from "./nav.js";

// Budget for one request's reply. The command loop never waits on it (each
// terminal drains its own queue in its own task), so a blocked nvim still lands
// its press when it frees up, as the reference does (the chord waits in nvim's
// typeahead there). Past this the request is abandoned; presses queued behind it
// are dropped when their own moment has passed (NAV_PRESS_TTL_MS).
const NVIM_TIMEOUT_MS = 10000;
const NAV_DISCOVERY = "splits-nav-probe.json";

// Chords each panel row cycles between; alt+letter is an alternative when
// another program already owns the ctrl chord.
const PRESETS = /** @type {Record<string, string[]>} */ ({
  left: ["ctrl+h", "alt+h"],
  right: ["ctrl+l", "alt+l"],
  up: ["ctrl+k", "alt+k"],
  down: ["ctrl+j", "alt+j"],
  settings: ["ctrl+shift+h", "alt+shift+h"],
});
const DIR_LABEL = /** @type {Record<string, string>} */ ({ left: "左", right: "右", up: "上", down: "下" });
/** @param {string} s @returns {string} */
const norm = (s) => String(s).replace(/\+/g, "-");
/** @param {unknown} e @returns {string} */
const errorText = (e) => (e instanceof Error ? e.message : String(e));
/** @param {Uint8Array} u8 @returns {string} */
const decodeChunk = (u8) => String.fromCharCode(...u8);

/** Race a promise against a remaining budget; rejects "timeout:<phase>" when
 *  spent, so a connect that never opened is told apart from a silent nvim.
 * @param {Promise<unknown>} promise @param {number} ms
 * @param {import("gpui-kit").AsyncContext} cx @param {string} phase
 * @returns {Promise<any>} */
function withBudget(promise, ms, cx, phase) {
  return Promise.race([
    promise,
    cx.sleep(Math.max(1, ms)).then(() => { throw new Error("timeout:" + phase); }),
  ]);
}

const PRUNE_TIMEOUT_MS = 200;
const DISCOVERY_NAME = /^nvim-(.+)\.json$/;

/** Delete discovery files whose nvim is gone. The plugin writes the file only
 *  after listen(), so a refused connect means the process died without running
 *  VimLeavePre (SIGKILL, crash): leftovers would otherwise pile up one per
 *  terminal id forever, since ids are never reused.
 * @param {import("gpui-kit").AsyncContext} cx @returns {Promise<void>} */
export async function pruneStaleDiscovery(cx) {
  const dir = appHome() + "/splits-nav";
  for (const name of await fs.readdir(dir).catch(() => /** @type {string[]} */ ([]))) {
    const terminal = DISCOVERY_NAME.exec(name)?.[1];
    if (!terminal) continue;
    const path = `${dir}/${name}`;
    const info = discoveryInfo(await readTextFile(path).catch(() => /** @type {string | null} */ (null)), terminal);
    if (!info) continue; // unreadable or odd shape: askNvim reports it
    const live = await withBudget(net.connect("127.0.0.1", info.port), PRUNE_TIMEOUT_MS, cx, "prune")
      .then((/** @type {import("net").Socket} */ sock) => { sock.close(); return true; }, () => false);
    if (!live) await fs.unlink(path).catch(() => {});
  }
}

/** The chord keys.json binds to one of our commands, or its default.
 * @param {string} command @returns {string | undefined} */
function boundChord(command) {
  const bound = keys().find((k) => k.action === `splits-nav.${command}`)?.keys;
  if (bound) {
    const chord = chordFromJsonChord(bound);
    if (isChord(chord)) return chord;
  }
  return DEFAULT_KEYS[command];
}

/** Move the herdr pane in a direction, unzooming first and wrapping at the
 *  layout edge. focused() is a per-turn snapshot: it still reports the old pane
 *  right after run("pane.go"), so poll until the app settles before deciding
 *  there is no neighbor. Returns whether focus ended somewhere else.
 * @param {import("gpui-kit").AsyncContext} cx @param {string} dir
 * @returns {Promise<boolean>} */
async function herdrMove(cx, dir) {
  const before = focused()?.pane;
  if (!before) return false;
  const pane = panes().find((p) => p.pane === before);
  if (pane?.zoomed) run("pane.zoom");
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await cx.sleep(16);
      if (focused()?.pane !== before) return true;
    }
    return false;
  };
  run("pane.go", { direction: dir });
  if (await settle()) return true;
  run("pane.go", { direction: REVERSE_DIRECTIONS[dir] }); // at the edge: wrap
  return settle();
}

/** Ask the focused nvim's plugin to nav or wrap. Returns the decoded response,
 *  "timeout" when nvim connected but stayed silent (busy in a long command),
 *  or null when the plugin is unreachable (no discovery file, bad payload,
 *  connect failure — after one re-read retry).
 * @param {import("gpui-kit").AsyncContext} cx @param {string} terminalId
 * @param {string} dir @param {string} [op] @returns {Promise<{action: string} | "timeout" | null>} */
async function askNvim(cx, terminalId, dir, op = "nav") {
  const keys = chordToLua(boundChord(dir) ?? DEFAULT_KEYS[dir]);
  const path = discoveryPath(appHome(), terminalId);
  /** @returns {Promise<{action: string}>} */
  const attempt = async () => {
    const info = discoveryInfo(await readTextFile(path), terminalId);
    if (!info) throw new Error("no discovery file");
    const deadline = Date.now() + NVIM_TIMEOUT_MS;
    const remaining = () => deadline - Date.now();
    const sock = await withBudget(net.connect("127.0.0.1", info.port), remaining(), cx, "connect");
    try {
      const line = encodeRequest(op, dir, keys, terminalId, info.pid) + "\n";
      await withBudget(sock.write(line), remaining(), cx, "write");
      let buf = "";
      while (true) {
        if (remaining() <= 0) throw new Error("timeout:read");
        const chunk = await withBudget(sock.read(4096), remaining(), cx, "read");
        if (chunk === null) break; // server closed
        buf += decodeChunk(chunk);
        if (buf.includes("\n")) break;
      }
      const resp = decodeResponse(buf.split("\n")[0]);
      if (!resp) throw new Error("bad response");
      return resp;
    } finally {
      sock.close();
    }
  };
  /** @param {unknown} e @returns {boolean} */
  const busy = (e) => e instanceof Error && (e.message === "timeout:read" || e.message === "timeout:write");
  try {
    return await attempt();
  } catch (e) {
    // Connected but silent: nvim is blocked in a long command. Its queued work
    // still runs when it frees up, so never resend (a second request would move
    // twice) and never move the pane behind its back.
    if (busy(e)) return "timeout";
  }
  try {
    return await attempt();
  } catch (e) {
    if (busy(e)) return "timeout";
    return null;
  }
}

export default class SplitsNav extends View {
  /** The overlay shows the panel; the docked copy is the invisible holder. */
  /** @type {boolean} */
  panel;
  /** @type {Record<string, string>} */
  keys;
  /** @type {{ kind: "info" | "error", text: string } | null} */
  status;
  /** @type {boolean} */
  busy;
  /** @type {number[]} */
  recent;
  /** @type {boolean} */
  nvimUnreachableNotified;
  /** Direction presses waiting per terminal, drained in order. */
  /** @type {NavQueue} */
  navQueue;
  /** Terminal ids whose queue is being drained right now. */
  /** @type {Set<string>} */
  nvimDraining;
  /** @type {import("gpui-kit").FocusHandle} */
  handle;

  /** @param {unknown} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    this.panel = Boolean(props()?.overlay);
    this.status = null;
    this.busy = false;
    this.recent = [];
    this.nvimUnreachableNotified = false;
    this.navQueue = new NavQueue();
    this.nvimDraining = new Set();
    this.handle = cx.focus_handle();
    if (this.panel) {
      // Seed from the bindings that are live now, so a hand-edited keys.json
      // is what the panel shows and an Apply starts from reality.
      this.keys = { ...DEFAULT_KEYS, settings: SETTINGS_KEY };
      for (const name of [...DIRECTIONS, "settings"]) {
        const chord = boundChord(name);
        if (chord) this.keys[name] = chord;
      }
      return;
    }
    this.keys = {};
    void pruneStaleDiscovery(cx);
    // Only the docked copy listens: a second copy's nextCommand() would race
    // for the same commands. Commands are handled serially (one at a time)
    // so a held key never stacks sockets.
    cx.spawn(async (cx) => {
      for (; ;) {
        const command = await nextCommand();
        if (command === "settings") {
          openOverlay({ mod: "splits-nav", kind: "dialog", width: 560 });
          continue;
        }
        if (command === "probe") {
          await this.probe(cx);
          continue;
        }
        if (command === "probe-geometry") {
          await this.probeGeometry(cx);
          continue;
        }
        if (DIRECTIONS.includes(command)) this.recent.push(Date.now());
        if (this.recent.length > 20) this.recent.shift();
        const f = focused();
        const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
        if (!pane?.terminal) continue; // a mod pane takes no keys
        if (pane.program.key !== "nvim") {
          await herdrMove(cx, command);
          continue;
        }
        // Every press is queued for its terminal; that terminal's drain task
        // runs them one after another, so presses keep their order and a quick
        // double tap still reaches nvim twice. A held key while nvim is stalled
        // fills the queue; past the cap the newest press is dropped.
        const terminal = pane.terminal;
        if (!this.navQueue.push(terminal, command)) continue;
        if (this.nvimDraining.has(terminal)) continue;
        this.nvimDraining.add(terminal);
        cx.spawn(async (task) => {
          try {
            for (;;) {
              const press = this.navQueue.shift(terminal);
              if (!press) break;
              if (focused()?.terminal !== terminal) {
                // The user left this pane: the rest of its presses are no
                // longer meant for it, so drop them instead of driving on.
                this.navQueue.clear(terminal);
                break;
              }
              let resp = await askNvim(task, terminal, press.dir);
              if (typeof resp === "object" && resp.action === "stale") {
                // The discovery entry is not this instance's: it may have been
                // replaced since we read it, so read it again once.
                resp = await askNvim(task, terminal, press.dir);
              }
              if (resp === "timeout") continue; // nvim stuck; the next press is fresh
              if (focused()?.terminal !== terminal) {
                // A late answer for a pane the user has left must not move it.
                this.navQueue.clear(terminal);
                break;
              }
              if (resp === null || resp.action === "stale" || resp.action === "ignore") {
                if (!this.nvimUnreachableNotified) {
                  notify({
                    title: "Splits Nav",
                    body: "nvim 插件未运行（或发现文件已过期），方向键已交给 herdr 移动 pane。确认已让 agent 跑 mods/splits-nav/link-nvim 并重启 nvim。",
                    level: "warning",
                  });
                  this.nvimUnreachableNotified = true;
                }
                await herdrMove(task, press.dir);
                continue;
              }
              this.nvimUnreachableNotified = false;
              if (resp.action === "edge") {
                // nvim has no window that way: move the herdr pane, and when
                // neither direction has a pane neighbour, bounce inside nvim
                // (the reference's at_edge=wrap) instead of swallowing the key.
                if (!(await herdrMove(task, press.dir))) await askNvim(task, terminal, press.dir, "wrap");
              }
              // moved / passthrough: nvim handled it.
            }
          } catch (e) {
            console.error("splits-nav:", e);
          } finally {
            this.nvimDraining.delete(terminal);
            this.navQueue.clear(terminal);
          }
        });
      }
    });
  }

  // ---- the panel ----

  /** @returns {string[]} */
  allChords() {
    return [...DIRECTIONS.map((d) => this.keys[d]), this.keys.settings];
  }

  /** Bindings of this chord that are not our own splits-nav actions.
   * @param {string} chord @returns {{ section: string, keys: string, action: string }[]} */
  conflicts(chord) {
    const n = norm(chord);
    return keys().filter((e) => norm(e.keys) === n && !String(e.action).startsWith("splits-nav.") && e.action !== "terminal");
  }

  /** @param {string} chord @returns {string[]} */
  warnings(chord) {
    const out = [];
    const hits = this.conflicts(chord);
    const higher = hits.filter((e) => e.section !== "global");
    if (higher.length) {
      const secs = [...new Set(higher.map((e) => e.section))].join("、");
      const acts = [...new Set(higher.map((e) => e.action))].join("、");
      out.push(`${secs} 段已把 ${chord} 绑给「${acts}」：优先级高于 global，这一键实际不会生效`);
    } else if (hits.length) {
      const acts = [...new Set(hits.map((e) => e.action))].join("、");
      out.push(`「${acts}」占用了 ${chord}：写入后会覆盖它`);
    }
    if (this.allChords().filter((c) => norm(c) === norm(chord)).length > 1) {
      out.push("与另一行重复：同一键只能有一个动作");
    }
    return out;
  }

  /** Reasons Apply must not write: a chord that cannot work, or two rows that
   *  would leave one direction unrouted. Overwriting a global action is only
   *  warned about, not blocked.
   * @returns {string[]} */
  blocking() {
    const chords = this.allChords();
    const out = [];
    for (const chord of chords) {
      if (chords.filter((c) => norm(c) === norm(chord)).length > 1) out.push(`${chord} 被两行共用`);
      const shadow = this.conflicts(chord).filter((e) => e.section !== "global");
      if (shadow.length) {
        const secs = [...new Set(shadow.map((e) => e.section))].join("/");
        const acts = [...new Set(shadow.map((e) => e.action))].join("、");
        out.push(`${chord} 被 ${secs} 段的「${acts}」占用，写了也不生效`);
      }
    }
    return [...new Set(out)];
  }

  /** @param {string} dir */
  cycle(dir) {
    const list = PRESETS[dir];
    const cur = this.keys[dir] ?? list[0];
    this.keys[dir] = list[(list.indexOf(cur) + 1) % list.length];
    this.status = null;
  }

  cycleSettings() {
    const list = PRESETS.settings;
    const cur = this.keys.settings;
    this.keys.settings = list[(list.indexOf(cur) + 1) % list.length];
    this.status = null;
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  async apply(cx) {
    if (this.busy) return;
    const blocked = this.blocking();
    if (blocked.length) {
      this.status = { kind: "error", text: blocked.join("；") };
      cx.notify();
      return;
    }
    this.busy = true;
    this.status = null;
    cx.notify();
    try {
      const path = appHome() + "/keys.json";
      let original = await readTextFile(path);
      if (original == null) throw new Error("keys.json 不存在：先确认 herdr 初始化过");
      const backup = `${appHome()}/keys.json.bak-${Date.now()}`;
      await writeTextFile(backup, original, null);
      let wrote = false;
      for (let i = 0; i < 2 && !wrote; i++) {
        try {
          await writeTextFile(path, mergeKeys(original, this.keys), original);
          wrote = true;
        } catch {
          original = await readTextFile(path); // stale: re-read and retry once
          if (original == null) throw new Error("keys.json 重读失败");
        }
      }
      if (!wrote) throw new Error("keys.json 被并发修改，重试后仍未写入");
      this.status = { kind: "info", text: `已应用 keys.json（备份 ${backup.split("/").pop()}）` };
    } catch (e) {
      this.status = { kind: "error", text: errorText(e) };
    }
    this.busy = false;
    cx.notify();
  }

  /** The mod's view of the app: focus, every pane, recent key stamps.
   * @returns {Record<string, unknown>} */
  snapshot() {
    return {
      at: new Date().toISOString(),
      focused: focused(),
      panes: panes().map((p) => ({
        pane: p.pane, terminal: p.terminal, mod: p.mod, tab: p.tab,
        title: p.title, programKey: p.program?.key, programName: p.program?.name,
        focused: p.focused, zoomed: p.zoomed, movable: p.movable,
      })),
      recentKeys: this.recent,
    };
  }

  /** @param {import("gpui-kit").AsyncContext} cx @param {Record<string, unknown>} data */
  async writeProbe(cx, data) {
    const path = appHome() + "/" + NAV_DISCOVERY;
    try {
      const prev = await readTextFile(path);
      await writeTextFile(path, JSON.stringify(data, null, 2), prev);
      this.status = { kind: "info", text: "已写入 " + path };
    } catch (e) {
      this.status = { kind: "error", text: errorText(e) };
    }
    cx.notify();
  }

  /** Write the probe snapshot. Read-only: no focus change.
   * @param {import("gpui-kit").AsyncContext} cx */
  async probe(cx) {
    await this.writeProbe(cx, this.snapshot());
  }

  /** Snapshot plus whether run("pane.go") moves focus before the next focused()
   *  call and whether the app shows it after a beat. The edge/wrap decision
   *  rests on that read being current, so measure both and restore focus.
   * @param {import("gpui-kit").AsyncContext} cx */
  async probeGeometry(cx) {
    /** @type {Record<string, unknown>[]} */
    const paneGoSync = [];
    for (const dir of ["left", "right", "up", "down"]) {
      const before = focused()?.pane;
      run("pane.go", { direction: dir });
      const sameTurn = focused()?.pane;
      await cx.sleep(80);
      const settled = focused()?.pane;
      if (before) run("pane.focus", { pane: before });
      await cx.sleep(80);
      paneGoSync.push({
        dir, before, sameTurn, settled,
        movedSync: sameTurn !== before,
        movedSettled: settled !== before,
        restored: focused()?.pane === before,
      });
    }
    await this.writeProbe(cx, { ...this.snapshot(), paneGoSync });
  }

  close() {
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  /** @returns {import("gpui-kit").Element} */
  renderPanel() {
    // theme() is keyed by name at run time but typed as plain strings; the
    // element builders want a Color, and a theme name is one to them.
    const t = /** @type {Record<string, import("gpui-kit").Color>} */ (theme());
    /** @param {string} chord @param {boolean} red */
    const chordButton = (chord, red) =>
      h_flex().h(26).px(10).items_center().rounded(6)
        .border_1().border_color(red ? t.blocked : t.input).bg(t.background)
        .text_size(12).font_medium().text_color(red ? t.blocked : t.foreground)
        .cursor_pointer().hover((s) => s.bg(t.hover)).child(`${chord} ▾`);
    /** @param {string} label @param {string} chord @param {boolean} red
     *  @param {(e: *, cx: *) => void} onCycle @param {string} note */
    const row = (label, chord, red, onCycle, note) =>
      h_flex().id(`row-${label}`).items_center().gap(10).w_full()
        .child(div().w(64).flex_none().text_size(12).text_color(t.dim).child(label))
        .child(chordButton(chord, red).on_click(onCycle))
        .child(div().flex_1().text_size(11).text_color(red ? t.blocked : t.muted).child(note));
    /** @param {string[]} warnings */
    const warningNote = (warnings) => warnings.join(" · ");

    const dirRows = DIRECTIONS.map((d) => {
      const chord = this.keys[d];
      const w = this.warnings(chord);
      const red = w.length > 0;
      const note = red ? warningNote(w) : "可用";
      return row(DIR_LABEL[d], chord, red, (_e, cx) => { this.cycle(d); cx.notify(); }, note);
    });
    const sChord = this.keys.settings;
    const sW = this.warnings(sChord);
    const settingsRow = row("打开设置", sChord, sW.length > 0, (_e, cx) => { this.cycleSettings(); cx.notify(); },
      sW.length ? warningNote(sW) : "可用");

    /** @param {string} id @param {string} text @param {boolean} primary
     *  @param {(e: *, cx: *) => void} action */
    const button = (id, text, primary, action) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8)
        .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
        .cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action).child(text);

    return v_flex().id("splits-nav-panel").track_focus(this.handle)
      .w_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.close(); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Splits Nav"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11).text_color(t.dim).child(
        "方向键按 keys.json 实际绑定读入；冲突以 keys() 为准，terminal 段优先于 global。"))
      .child(v_flex().gap(4).children(dirRows))
      .child(settingsRow)
      .child(h_flex().pt(4).gap(8).justify_end()
        // Apply outlives the click, so it runs in a spawned task: the click's
        // own context is stale after the first await.
        .child(button("sn-apply", "Apply", true, (_e, cx) => {
          cx.spawn((/** @type {import("gpui-kit").AsyncContext} */ task) => this.apply(task));
        }))
        .child(button("sn-close", "Close", false, () => this.close())))
      .child(div().h(18).text_size(11).text_color(this.status?.kind === "error" ? t.blocked : t.done)
        .child(this.status?.text ?? ""));
  }

  render() {
    // The docked holder draws nothing; it only exists to receive commands.
    return this.panel ? this.renderPanel() : div().w(0).h(0);
  }
}
