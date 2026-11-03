// Pure helpers for the Splits Nav mod. No host imports, so node can test
// them directly. Chords are spelled with "+" here ("ctrl+h", "ctrl+left");
// keys.json uses "ctrl-h" / "ctrl-left", nvim uses "<C-h>" / "<C-Left>", and
// the discovery protocol is JSON over TCP. cmd may be bound (keys.json, the
// panel), so isChord accepts it, but nvim can never receive a cmd chord:
// chordToLua refuses it and the direction/resize rows do not offer it.

/** @type {Record<string, string>} */
export const DEFAULT_KEYS = {
  left: "ctrl+h", right: "ctrl+l", up: "ctrl+k", down: "ctrl+j",
  "resize-left": "alt+h", "resize-right": "alt+l",
  "resize-up": "alt+k", "resize-down": "alt+j",
};
export const SETTINGS_KEY = "cmd+shift+s";
export const DIRECTIONS = ["left", "right", "up", "down"];
/** The resize commands, one per direction: `resize-<dir>`. */
export const RESIZES = DIRECTIONS.map((d) => `resize-${d}`);
export const ALL_COMMANDS = [...DIRECTIONS, ...RESIZES, "settings"];

/** Whether a recording marker still silences the docked command loop: an
 *  object whose `at` stamp is within the TTL. Anything else (a marker written
 *  by an older build, a missing stamp, an expired one) is stale: the caller
 *  clears it and runs the command instead.
 * @param {unknown} value @param {number} now @param {number} ttl @returns {boolean} */
export function isFreshRecording(value, now, ttl) {
  const at = (typeof value === "object" && value !== null) ? /** @type {any} */ (value).at : undefined;
  return typeof at === "number" && now - at < ttl;
}

/** @type {Record<string, string>} */
export const REVERSE_DIRECTIONS = { left: "right", right: "left", up: "down", down: "up" };

const MODS = new Set(["ctrl", "alt", "shift", "cmd"]);
// The modifiers a chord must carry at least one of: a lone shift is just
// typing. Shared by isChord and chordFromKeystroke so both agree.
const REAL_MODS = ["ctrl", "alt", "cmd"];
const ACTIONS = new Set(["moved", "edge", "passthrough", "ignore", "stale"]);

/** Named keys that are also bindable: the app spells them like this, nvim like
 *  the value. One map, so what the panel accepts and what nvim gets cannot drift.
 *  @type {Record<string, string>} */
const NAMED_KEYS = { left: "Left", right: "Right", up: "Up", down: "Down" };

/** How many presses one terminal may have waiting. Only a held key while nvim is
 *  stalled can reach it; past that the newest press is dropped, not replayed late. */
export const NAV_BACKLOG_MAX = 8;
/** A queued press is dropped once its moment has passed by this much. */
export const NAV_PRESS_TTL_MS = 2000;

/** A direction press waiting for its turn. dir/op are derived from command
 *  ("left" -> nav, "resize-left" -> resize), so callers only carry the name.
 *  @typedef {{command: string, dir: string, op: string, at: number}} NavPress */

/** Per-terminal press queue. Presses keep their order (the caller runs one
 *  terminal's presses one after another) and every discrete press is kept until
 *  the cap or its TTL, so a quick double tap still reaches nvim twice. Pure, so
 *  selftest.mjs can drive it. */
export class NavQueue {
  /** @param {number} [max] */
  constructor(max = NAV_BACKLOG_MAX) {
    /** @type {number} */
    this.max = max;
    /** @type {Map<string, NavPress[]>} */
    this.byTerminal = new Map();
  }

  /** @param {string} terminal @param {string} command @returns {boolean} false when the backlog is full */
  push(terminal, command) {
    const q = this.byTerminal.get(terminal) ?? [];
    if (q.length >= this.max) return false;
    const resize = command.startsWith("resize-");
    q.push({
      command,
      dir: resize ? command.slice("resize-".length) : command,
      op: resize ? "resize" : "nav",
      at: Date.now(),
    });
    this.byTerminal.set(terminal, q);
    return true;
  }

  /** The next press whose moment has not passed (expired ones are skipped).
   * @param {string} terminal @param {number} [now] @returns {NavPress | undefined} */
  shift(terminal, now = Date.now()) {
    const q = this.byTerminal.get(terminal);
    if (!q) return undefined;
    for (; ;) {
      const item = q.shift();
      if (!item) {
        this.byTerminal.delete(terminal);
        return undefined;
      }
      if (now - item.at <= NAV_PRESS_TTL_MS) return item;
    }
  }

  /** @param {string} terminal @returns {number} */
  pending(terminal) {
    return this.byTerminal.get(terminal)?.length ?? 0;
  }

  /** @param {string} terminal */
  clear(terminal) {
    this.byTerminal.delete(terminal);
  }
}
const LUA_MOD = /** @type {Record<string, string>} */ ({ ctrl: "C", alt: "A", shift: "S" });

/** A chord this code can turn into nvim notation: modifiers, then one letter,
 *  digit or arrow key, carrying ctrl, alt or cmd. A shift-only chord is not one
 *  (shift+letter is just typing), so it is refused like everything else, and a
 *  stray shared or hand-edited value can never reach a request or keys.json.
 *  cmd counts here (keys.json / the panel may bind it) but chordToLua refuses
 *  it: nvim never sees a cmd chord.
 * @param {string} chord @returns {boolean} */
export function isChord(chord) {
  const parts = String(chord).toLowerCase().split("+");
  const tail = parts.pop() ?? "";
  return (/^[a-z0-9]$/.test(tail) || Object.hasOwn(NAMED_KEYS, tail)) &&
    parts.length > 0 && parts.every((p) => MODS.has(p)) &&
    parts.some((p) => REAL_MODS.includes(p));
}

/** Ordering of the panel's chord spelling: ctrl, cmd, alt, then shift. */
const MOD_ORDER = ["ctrl", "cmd", "alt", "shift"];

/** Parse a keystroke into the panel's chord spelling ("ctrl-shift-h" ->
 *  "ctrl+shift+h"). Only ctrl/alt/shift plus one letter, digit or direction key
 *  qualify, and the chord must carry ctrl, alt or cmd (a lone shift is
 *  refused); anything else returns null. With allowCmd, cmd counts as a
 *  modifier too: the settings row opens it, since nvim never receives it, so
 *  the direction/resize rows leave it off (keystroke is not a chord without
 *  it). The modifiers come out in the canonical ctrl->cmd->alt->shift order,
 *  so a chord written into keys.json is always the normal form.
 * @param {string} keystroke @param {boolean} [allowCmd] @returns {string | null} */
export function chordFromKeystroke(keystroke, allowCmd = false) {
  const parts = String(keystroke).toLowerCase().split("-");
  const key = parts.pop() ?? "";
  if (!/^[a-z0-9]$/.test(key) && !Object.hasOwn(NAMED_KEYS, key)) return null;
  if (parts.length === 0 || !parts.every((p) => allowCmd ? MODS.has(p) : p !== "cmd" && MODS.has(p))) return null;
  if (!parts.some((p) => REAL_MODS.includes(p))) return null;
  return [...MOD_ORDER.filter((m) => parts.includes(m)), key].join("+");
}

/** "ctrl+h" -> "ctrl-h" (keys.json spelling).
 * @param {string} chord @returns {string} */
export function keysToJsonChord(chord) {
  return chord.replace(/\+/g, "-");
}

/** "ctrl-h" -> "ctrl+h" (panel spelling, from keys()).
 * @param {string} chord @returns {string} */
export function chordFromJsonChord(chord) {
  return chord.replace(/-/g, "+");
}

/**
 * Returns new keys.json text with the splits-nav bindings applied: the four
 * direction chords, the four resize chords and the settings chord, all in
 * `global`. Any leftover entry whose action targets splits-nav is dropped;
 * everything else is kept. Throws on invalid JSON, a `global` that isn't an
 * object, or a chord that isn't a plain modifier+key.
 * @param {string} text @param {Record<string, string>} [keys] @returns {string}
 */
export function mergeKeys(text, keys) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("keys.json is not valid JSON; nothing written");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("keys.json must be an object");
  }
  if (obj.global === undefined) obj.global = {};
  if (!obj.global || typeof obj.global !== "object" || Array.isArray(obj.global)) {
    throw new Error('keys.json "global" is not an object; nothing written');
  }
  for (const section of Object.keys(obj)) {
    const table = obj[section];
    if (!table || typeof table !== "object" || Array.isArray(table)) continue;
    for (const k of Object.keys(table)) {
      if (String(table[k]).startsWith("splits-nav.")) delete table[k];
    }
  }
  const merged = /** @type {Record<string, string>} */ ({ ...DEFAULT_KEYS, settings: SETTINGS_KEY, ...keys });
  for (const [name, chord] of Object.entries(merged)) {
    if (!isChord(chord)) throw new Error(`bad chord (${name}): ${chord}`);
  }
  const global = obj.global;
  for (const name of [...DIRECTIONS, ...RESIZES]) {
    global[keysToJsonChord(merged[name])] = `splits-nav.${name}`;
  }
  global[keysToJsonChord(merged.settings)] = "splits-nav.settings";
  return JSON.stringify(obj, null, 2) + "\n";
}

/** "ctrl+h" -> "<C-h>", "ctrl+left" -> "<C-Left>" (nvim spelling). A cmd chord
 *  is refused here: nvim never receives one, and LUA_MOD has no entry for it.
 * @param {string} chord @returns {string} */
export function chordToLua(chord) {
  if (!isChord(chord)) throw new Error(`bad chord: ${chord}`);
  const parts = String(chord).toLowerCase().split("+");
  if (parts.includes("cmd")) throw new Error("bad chord (nvim never sees cmd): " + chord);
  const tail = parts.pop() ?? "";
  const key = Object.hasOwn(NAMED_KEYS, tail) ? NAMED_KEYS[tail] : tail;
  const mods = parts.map((m) => LUA_MOD[m]);
  return "<" + [...mods, key].join("-") + ">";
}

/** Where the nvim plugin advertises itself for one terminal: one file per
 *  terminal id, under <appHome>/splits-nav/.
 * @param {string} appHomeDir @param {string} terminalId @returns {string} */
export function discoveryPath(appHomeDir, terminalId) {
  return `${appHomeDir}/splits-nav/nvim-${terminalId}.json`;
}

/** One request line: {"op":"nav"|"wrap"|"resize","dir":...,"keys":"<C-h>","terminal":...,
 *  "pid":...}. terminal+pid repeat the instance the sender intends to reach, so
 *  the server can refuse a request meant for a stale discovery file whose port
 *  is now bound by another nvim.
 * @param {string} op @param {string} dir @param {string} keys
 * @param {string} [terminal] @param {number} [pid] @returns {string} */
export function encodeRequest(op, dir, keys, terminal, pid) {
  return JSON.stringify({ op, dir, keys, terminal, pid });
}

/** One response line: {"action":"moved"|"edge"|"passthrough"|"ignore","t":{...}}.
 *  Returns null for anything else (bad JSON, not an object, unknown action), so
 *  the caller treats a stray line as "no answer" and never swallows the key.
 * @param {string} line @returns {{action: string, t?: {rx: number, tx: number}} | null} */
export function decodeResponse(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (!ACTIONS.has(obj.action)) return null;
  return obj;
}

/** The port and pid a discovery file advertises, or null when the file is
 *  missing, unreadable, stale-shaped or names another terminal (a nested nvim of
 *  a different pane).
 * @param {string | null} text @param {string} terminalId
 * @returns {{port: number, pid: number} | null} */
export function discoveryInfo(text, terminalId) {
  if (text == null) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (obj.schema !== 1 || typeof obj.port !== "number" || typeof obj.pid !== "number") return null;
  if (obj.terminal !== terminalId) return null;
  return { port: obj.port, pid: obj.pid };
}
