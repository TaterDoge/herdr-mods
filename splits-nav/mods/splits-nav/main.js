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
  appHome, closeOverlay, exec, focused, keys, nextCommand, notify, openOverlay,
  panes, props, readTextFile, run, setShared, shared, theme, window, writeTextFile,
} from "herdr";
import net from "net";
import * as fs from "fs/promises";
import {
  ALL_COMMANDS, DEFAULT_KEYS, DIRECTIONS, NavQueue, RESIZES, REVERSE_DIRECTIONS, SETTINGS_KEY,
  chordFromJsonChord, chordFromKeystroke, chordToLua, decodeResponse, discoveryInfo, discoveryPath,
  encodeRequest, isChord, isFreshRecording, mergeKeys,
} from "./nav.js";
import { autoInstall, linkNotify } from "./install.js";
import { layoutPlan, shippedLayouts } from "./layouts.js";

// Budget for one request's reply. The command loop never waits on it (each
// terminal drains its own queue in its own task), so a blocked nvim still lands
// its press when it frees up, as the reference does (the chord waits in nvim's
// typeahead there). Past this the request is abandoned; presses queued behind it
// are dropped when their own moment has passed (NAV_PRESS_TTL_MS).
const NVIM_TIMEOUT_MS = 10000;
// The shared recording marker only silences the command loop while a capture
// is in progress. No panel may be left to clear it (light dismiss, the panel
// instance being swapped out), so past this age the next command clears it
// itself and runs: a stuck mute never outlives this long.
const RECORDING_TTL_MS = 2 * 60 * 1000;
const NAV_DISCOVERY = "splits-nav-probe.json";
/** One resize notch as a herdr ratio (3% of the terminal dimension),
 *  matching the reference plugin's default_amount. */
const HERDR_RESIZE_AMOUNT = 0.03;

// Bare modifier presses are not chords; while recording, they are ignored so
// the user can set a modifier down and then pick the key. Same list as
// herdr-customize's MODIFIER_KEYS.
const MODIFIER_KEYS = ["shift", "control", "ctrl", "alt", "platform", "cmd", "super", "fn", "function", "meta"];
const DIR_LABEL = /** @type {Record<string, string>} */ ({
  left: "左", right: "右", up: "上", down: "下",
  "resize-left": "调左", "resize-right": "调右", "resize-up": "调上", "resize-down": "调下",
});
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

  /** @param {string} command @returns {string | undefined} */
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

/** Ask the app whether the focused pane has a neighbour in a direction: pane.go
 *  moves focus there, and the move is then undone. Unlike herdrMove this never
 *  wraps, and it restores focus, so a resize key neither changes focus nor
 *  crosses a boundary. Returns the neighbour's pane id, or null.
 *  @param {import("gpui-kit").AsyncContext} cx @param {string} dir @param {string} from
 *  @returns {Promise<string | null>} */
async function probeNeighbour(cx, dir, from) {
  run("pane.go", { direction: dir });
  for (let i = 0; i < 8; i++) {
    await cx.sleep(16);
    const now = focused()?.pane;
    if (now && now !== from) {
      run("pane.focus", { pane: from });
      for (let j = 0; j < 8 && focused()?.pane !== from; j++) await cx.sleep(16);
      return now;
    }
  }
  return null;
}

/** A pane's size in terminal cells, the only measure of a pane a mod can read:
 *  `hc get <address>` reports the grid. Null when it can't be read.
 *  @typedef {{cols: number, rows: number}} Cells
 *  @param {string} address
 *  @returns {Promise<Cells | null>} */
async function paneCells(address) {
  const out = await exec("hc", ["get", address]);
  if (out.code !== 0) return null;
  /** @type {any} */
  let info;
  try {
    info = JSON.parse(out.stdout);
  } catch {
    return null;
  }
  return typeof info.cols === "number" && typeof info.rows === "number"
    ? { cols: info.cols, rows: info.rows }
    : null;
}

/** Resize the focused herdr pane one notch. Panes are runtime layout nodes whose
 *  ids are the pane ids, so `layout.resize` sizes them; the notch is a share of
 *  the axis, which is why each pane's current size is read first (a pane's
 *  weight has no other way to be read).
 *  The direction names the border that moves, as in herdr-splits.nvim: the pane
 *  grows when the neighbour on that side gives way, and shrinks when the border
 *  on the opposite side eats into it. A side with no neighbour resizes nothing.
 *  @param {import("gpui-kit").AsyncContext} cx @param {string} dir
 *  @param {string} terminal @param {(e: unknown) => void} [onError]
 *  @returns {Promise<void>} */
async function herdrResize(cx, dir, terminal, onError) {
  try {
    const pane = panes().find((p) => p.terminal === terminal);
    if (!pane || pane.zoomed) return; // a mod pane, or zoom has no border
    const mine = await paneCells(terminal);
    if (!mine) return;
    const beside = await probeNeighbour(cx, dir, pane.pane);
    const neighbour = beside ?? await probeNeighbour(cx, REVERSE_DIRECTIONS[dir], pane.pane);
    if (!neighbour) return; // one pane on this axis: nothing to move
    const theirPane = panes().find((p) => p.pane === neighbour);
    const theirs = theirPane?.terminal ? await paneCells(theirPane.terminal) : null;
    if (!theirs) return;
    const horizontal = dir === "left" || dir === "right";
    const myAxis = horizontal ? mine.cols : mine.rows;
    const theirAxis = horizontal ? theirs.cols : theirs.rows;
    if (Math.abs((horizontal ? mine.rows : mine.cols) - (horizontal ? theirs.rows : theirs.cols)) > 1) {
      return; // not the same row/column: the border between them is not ours
    }
    const step = Math.max(2, Math.round(HERDR_RESIZE_AMOUNT * (myAxis + theirAxis)));
    const grow = beside ? 1 : -1; // border on that side moves out (grow) or in (shrink)
    const moving = Math.max(2, Math.min(myAxis + grow * step, myAxis + theirAxis - 2));
    const delta = moving - myAxis;
    run("layout.resize", { id: pane.pane, weight: moving });
    run("layout.resize", { id: neighbour, weight: theirAxis - delta });
  } catch (e) {
    onError?.(e);
  }
}

/** Ask the focused nvim's plugin to nav or resize. dir is the bare direction
 *  ("left"), command the command name ("left" or "resize-left"); exactly one
 *  must be given. Returns the decoded response, "timeout" when nvim connected
 *  but stayed silent (busy in a long command), "nokey" when the bound chord
 *  names cmd (nvim never receives one), or null when the plugin is
 *  unreachable (no discovery file, bad payload, connect failure — after one
 *  re-read retry).
 * @param {import("gpui-kit").AsyncContext} cx @param {string} terminalId
 * @param {string} dir @param {string} [op] @param {string} [command]
 * @returns {Promise<{action: string} | "timeout" | "nokey" | null>} */
async function askNvim(cx, terminalId, dir, op = "nav", command = dir) {
  const chord = boundChord(command) ?? DEFAULT_KEYS[command];
  let keys;
  try { keys = chordToLua(chord); } catch { return "nokey"; } // a cmd chord: nvim never sees it
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
  /** @type {boolean} */
  resizeErrorNotified;
  /** @type {boolean} */
  layoutErrorNotified;
  /** Direction presses waiting per terminal, drained in order. */
  /** @type {NavQueue} */
  navQueue;
  /** Terminal ids whose queue is being drained right now. */
  /** @type {Set<string>} */
  nvimDraining;
  /** @type {import("gpui-kit").FocusHandle} */
  handle;
  /** Command whose row is recording a new chord right now, or null. */
  /** @type {string | null} */
  recording;
  /** Last keystroke refused while recording (shown in that row's note). */
  /** @type {string | null} */
  badKey;

  /** @param {unknown} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    this.panel = Boolean(props()?.overlay);
    this.status = null;
    this.busy = false;
    this.recent = [];
    this.nvimUnreachableNotified = false;
    this.resizeErrorNotified = false;
    this.layoutErrorNotified = false;
    this.navQueue = new NavQueue();
    this.nvimDraining = new Set();
    this.handle = cx.focus_handle();
    this.recording = null;
    this.badKey = null;
    if (this.panel) {
      // Seed from the bindings that are live now, so a hand-edited keys.json
      // is what the panel shows and an Apply starts from reality.
      this.keys = { ...DEFAULT_KEYS, settings: SETTINGS_KEY };
      for (const name of ALL_COMMANDS) {
        const chord = boundChord(name);
        if (chord) this.keys[name] = chord;
      }
      return;
    }
    this.keys = {};
    /** One failure notice per load, not one per keypress.
     *  @param {unknown} e */
    const resizeErr = (e) => this.resizeError(e);
    void pruneStaleDiscovery(cx);
    // Wire the nvim half on first real load. Only the docked copy does this
    // (the overlay panel is a dialog), and only in a real window: the checker
    // has none, so check stays free of side effects. Fire-and-forget — exec
    // runs off the UI thread and the press queue below is untouched.
    void this.autoInstallLinkNvim();
    // Same reasoning for the layouts: a copy is only laid into a layout while a
    // copy of the mod is running (a layout without one runs nothing), which is
    // exactly when this init runs.
    void this.plantLayouts();
    // Only the docked copy listens: a second copy's nextCommand() would race
    // for the same commands. Commands are handled serially (one at a time)
    // so a held key never stacks sockets.
    cx.spawn(async (cx) => {
      for (; ;) {
        const command = await nextCommand();
        // While the panel records a chord, the bound key that is being pressed
        // would otherwise also run its command here (and move a pane / open an
        // overlay), so silence the command loop until the recording ends. The
        // marker carries a timestamp; past the TTL the next command clears it
        // and runs, so a stuck mute (panel gone via light dismiss, hot reload,
        // or a layout swap) self-heals instead of swallowing commands forever.
        const recording = shared("splits-nav.recording");
        if (isFreshRecording(recording, Date.now(), RECORDING_TTL_MS)) continue;
        // A marker nobody is refreshing (panel gone via light dismiss / reload /
        // layout swap) or one written by an older build: drop it and run the command.
        if (recording) setShared("splits-nav.recording", null);
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
        const resize = RESIZES.includes(command);
        if (DIRECTIONS.includes(command) || resize) this.recent.push(Date.now());
        if (this.recent.length > 20) this.recent.shift();
        const f = focused();
        const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
        if (!pane?.terminal) continue; // a mod pane takes no keys
        if (pane.program.key !== "nvim") {
          await (resize ? herdrResize(cx, command.slice("resize-".length), pane.terminal, resizeErr) : herdrMove(cx, command));
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
              let resp = await askNvim(task, terminal, press.dir, press.op, press.command);
              if (typeof resp === "object" && resp.action === "stale") {
                // The discovery entry is not this instance's: it may have been
                // replaced since we read it, so read it again once.
                resp = await askNvim(task, terminal, press.dir, press.op, press.command);
              }
              if (resp === "timeout") continue; // nvim stuck; the next press is fresh
              if (resp === "nokey") {
                // The bound chord names cmd, which nvim never sees: act on the
                // herdr pane directly, without the nvim-unreachable notice.
                await (press.op === "resize"
                  ? herdrResize(task, press.dir, terminal, resizeErr)
                  : herdrMove(task, press.dir));
                continue;
              }
              if (focused()?.terminal !== terminal) {
                // A late answer for a pane the user has left must not move it.
                this.navQueue.clear(terminal);
                break;
              }
              if (resp === null || resp.action === "stale" || resp.action === "ignore") {
                if (!this.nvimUnreachableNotified) {
                  notify({
                    title: "Splits Nav",
                    body: "nvim 插件未运行（或版本较旧/发现文件已过期），方向键已交给 herdr 处理；resize 会直接改 pane 大小。自动安装失败请看通知，修复后重启 nvim。",
                    level: "warning",
                  });
                  this.nvimUnreachableNotified = true;
                }
                await (press.op === "resize"
                  ? herdrResize(task, press.dir, terminal, resizeErr)
                  : herdrMove(task, press.dir));
                continue;
              }
              this.nvimUnreachableNotified = false;
              if (resp.action === "edge") {
                // nvim has no window that way: act on the herdr pane. A resize
                // always falls through; a move that finds no pane neighbour
                // either bounces inside nvim (the reference's at_edge=wrap).
                if (press.op === "resize") {
                  await herdrResize(task, press.dir, terminal, resizeErr);
                } else if (!(await herdrMove(task, press.dir))) {
                  await askNvim(task, terminal, press.dir, "wrap", press.command);
                }
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

  /** Report a resize failure once per load, so a broken core path is visible
   *  instead of silently doing nothing (the app and herdr-core have no pane
   *  resize command; this one goes through the `herdr` CLI).
   * @param {unknown} e */
  resizeError(e) {
    if (this.resizeErrorNotified) return;
    this.resizeErrorNotified = true;
    notify({ title: "Splits Nav", body: "调整 pane 大小失败（herdr CLI）：" + errorText(e), level: "error" });
  }

  /** Run the user's link-nvim once (idempotent: relinks a dangling link,
   *  leaves a valid one alone, errors on a real file in the way). Notify only
   *  when it actually changed something, so a working setup stays quiet.
   * @returns {Promise<void>} */
  async autoInstallLinkNvim() {
    if (!window()) return;
    try {
      const notice = linkNotify(await autoInstall(exec, appHome()));
      if (notice) notify(notice);
    } catch (e) {
      notify({
        title: "Splits Nav",
        body: "自动安装 nvim 插件失败：" + errorText(e) + "，可手动运行 link-nvim 排查。",
        level: "error",
      });
    }
  }

  /** Lay a copy of this mod into every layout. A mod runs only where a layout
   *  mounts it, so without a copy the keys are dead in that layout. Idempotent:
   *  a layout that already mounts the mod anywhere is left untouched, and a copy
   *  for one of Herdr's own layouts is made once (afterwards nothing is written
   *  at all). Only in a real window, like link-nvim: `herdr-app check` has none,
   *  so a check stays free of side effects.
   * @returns {Promise<void>} */
  async plantLayouts() {
    if (!window()) return;
    try {
      const dir = appHome() + "/layouts";
      const names = (await fs.readdir(dir).catch(() => /** @type {string[]} */ ([])))
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.slice(0, -".json".length));
      /** @type {{name: string, text: string | null}[]} */
      const files = [];
      for (const name of names) {
        /** @type {string | null} */
        let text = null;
        try {
          text = await readTextFile(`${dir}/${name}.json`);
        } catch {
          text = null; // unreadable: no plan entry for it
        }
        files.push({ name, text });
      }
      // Herdr's own layouts, from its ledger: never written, copied instead.
      /** @type {string | null} */
      let ledger = null;
      try {
        ledger = await readTextFile(appHome() + "/installed.json");
      } catch {
        ledger = null; // no ledger: shown names still count as its own
      }
      /** @type {string[]} */
      const made = [];
      for (const write of layoutPlan(files, shippedLayouts(ledger))) {
        await writeTextFile(`${dir}/${write.name}.json`, write.text, write.expected);
        if (write.expected === null) made.push(write.name);
      }
      if (made.length) {
        notify({
          title: "Splits Nav",
          body: `已自动给这些布局挂上副本，切过去也能用：${made.join("、")}`,
          level: "info",
        });
      }
    } catch (e) {
      if (this.layoutErrorNotified) return;
      this.layoutErrorNotified = true;
      notify({
        title: "Splits Nav",
        body: "自动把副本挂进布局失败：" + errorText(e) + "；其它布局里的键不会生效。手动挂载：往那份布局里加 "
          + '{"id":"splits-nav","content":{"mod":"splits-nav"},"peek":0}。',
        level: "error",
      });
    }
  }

  // ---- the panel ----

  /** @returns {string[]} */
  allChords() {
    return [...ALL_COMMANDS.map((c) => this.keys[c])];
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

  /** Begin recording a new chord for one command. Clicking another row's
   *  button switches the recording to that row; a successful capture or Esc
   *  ends it (see the panel's on_key_down). The marker is shared so the
   *  docked copy knows to hold its command loop.
   * @param {string} command */
  startRecording(command) {
    this.recording = command;
    this.badKey = null;
    setShared("splits-nav.recording", { command, at: Date.now() });
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
      this.status = { kind: "info", text: "已应用 keys.json" };
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
    if (this.recording) { this.recording = null; this.badKey = null; setShared("splits-nav.recording", null); }
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
  }

  /** @returns {import("gpui-kit").Element} */
  renderPanel() {
    // theme() is keyed by name at run time but typed as plain strings; the
    // element builders want a Color, and a theme name is one to them.
    const t = /** @type {Record<string, import("gpui-kit").Color>} */ (theme());
    /** @param {string} label @param {boolean} red */
    const chordButton = (label, red) =>
      h_flex().h(26).px(10).items_center().rounded(6)
        .border_1().border_color(red ? t.blocked : t.input).bg(t.background)
        .text_size(12).font_medium().text_color(red ? t.blocked : t.foreground)
        .cursor_pointer().hover((s) => s.bg(t.hover)).child(label);
    /** @param {string} label @param {string} buttonLabel @param {boolean} red
     *  @param {(e: *, cx: *) => void} onRecord @param {string} note
     *  @param {boolean} [error] */
    const row = (label, buttonLabel, red, onRecord, note, error = false) =>
      h_flex().id(`row-${label}`).items_center().gap(10).w_full()
        .child(div().w(64).flex_none().text_size(12).text_color(t.dim).child(label))
        .child(chordButton(buttonLabel, red).on_click(onRecord))
        // min_w(0): a flex item defaults to its content width, so without this
        // a long warning runs off the panel instead of wrapping.
        .child(div().flex_1().min_w(0).text_size(11).text_color(error || red ? t.blocked : t.muted).child(note));
    /** @param {string[]} warnings */
    const warningNote = (warnings) => warnings.join(" · ");
    /** @param {boolean} recording @param {string} idleNote @param {boolean} [cmdRow] */
    const recordNote = (recording, idleNote, cmdRow = false) => {
      if (!recording) return { text: idleNote, error: false };
      if (this.badKey) {
        return {
          text: cmdRow
            ? `不支持 ${this.badKey}：只认 ctrl/alt/shift/cmd + 一个字母、数字或方向键，且必须带 ctrl、alt 或 cmd`
            : `不支持 ${this.badKey}：只认 ctrl/alt/shift + 一个字母、数字或方向键，且必须带 ctrl 或 alt（cmd 组合 nvim 收不到）`,
          error: true,
        };
      }
      return { text: "按下按键…（Esc 取消）", error: false };
    };

    /** @param {string} name */
    const rowFor = (name) => {
      const chord = this.keys[name];
      const w = this.warnings(chord);
      const recording = this.recording === name;
      const red = !recording && w.length > 0;
      const note = recordNote(recording, red ? warningNote(w) : "可用");
      const label = recording ? "按下按键…" : `${chord} ▾`;
      return row(DIR_LABEL[name], label, red, (_e, cx) => { this.startRecording(name); cx.notify(); },
        note.text, note.error);
    };
    const navRows = DIRECTIONS.map(rowFor);
    const resizeRows = RESIZES.map(rowFor);
    const sChord = this.keys.settings;
    const sW = this.warnings(sChord);
    const recording = this.recording === "settings";
    const sRed = !recording && sW.length > 0;
    const sNote = recordNote(recording, sRed ? warningNote(sW) : "可用", true);
    const settingsRow = row("打开设置", recording ? "按下按键…" : `${sChord} ▾`, sRed,
      (_e, cx) => { this.startRecording("settings"); cx.notify(); }, sNote.text, sNote.error);

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
        if (this.recording) {
          // Refresh the marker's timestamp: the docked copy mutes by this
          // stamp, so a key pressed well after the row was clicked must still
          // be silenced (not treated as expired).
          setShared("splits-nav.recording", { command: this.recording, at: Date.now() });
          if (e.key === "escape") {
            this.recording = null;
            this.badKey = null;
            setShared("splits-nav.recording", null);
          } else if (MODIFIER_KEYS.includes(String(e.keystroke).toLowerCase())) {
            // A bare modifier press is not a chord: wait for the rest.
          } else {
            const command = this.recording;
            const chord = chordFromKeystroke(e.keystroke, this.recording === "settings");
            if (command && chord) {
              this.keys[command] = chord;
              this.recording = null;
              this.badKey = null;
              setShared("splits-nav.recording", null);
            } else {
              this.badKey = e.keystroke;
            }
          }
          cx.stop_propagation();
          cx.notify();
          return;
        }
        if (e.key === "escape") { this.close(); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("Splits Nav"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11).text_color(t.dim).child(
        "点按键然后按下要用的键（Esc 取消）：只认 ctrl/alt/shift + 一个字母、数字或方向键，且必须带 ctrl 或 alt（打开设置那行还认 cmd）。方向/resize 键要能转成 nvim 记法；冲突以 keys() 为准，terminal 段优先于 global。"))
      .child(v_flex().gap(4).children(navRows))
      .child(v_flex().gap(4).children(resizeRows))
      .child(settingsRow)
      .child(h_flex().pt(4).gap(8).justify_end()
        // Apply outlives the click, so it runs in a spawned task: the click's
        // own context is stale after the first await.
        .child(button("sn-apply", "Apply", true, (_e, cx) => {
          cx.spawn((/** @type {import("gpui-kit").AsyncContext} */ task) => this.apply(task));
        }))
        .child(button("sn-close", "Close", false, () => this.close())))
      // min_h, not h: a blocked Apply joins its reasons with "；" and those
      // lines must wrap instead of being cut off at a one-line box.
      .child(div().w_full().min_h(18).min_w(0).text_size(11).text_color(this.status?.kind === "error" ? t.blocked : t.done)
        .child(this.status?.text ?? ""));
  }

  render() {
    // The docked holder draws nothing; it only exists to receive commands.
    return this.panel ? this.renderPanel() : div().w(0).h(0);
  }
}
