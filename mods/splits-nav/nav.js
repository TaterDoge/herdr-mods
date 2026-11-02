// Pure helpers for the Splits Nav mod. No host imports, so node can test
// them directly. Chords are spelled with "+" here ("ctrl+h"); keys.json uses
// "ctrl-h", nvim uses "<C-h>", and the discovery protocol is JSON over TCP.

/** @type {Record<string, string>} */
export const DEFAULT_KEYS = { left: "ctrl+h", right: "ctrl+l", up: "ctrl+k", down: "ctrl+j" };
export const SETTINGS_KEY = "ctrl+shift+h";
export const DIRECTIONS = ["left", "right", "up", "down"];

/** @type {Record<string, string>} */
export const REVERSE_DIRECTIONS = { left: "right", right: "left", up: "down", down: "up" };

const MODS = new Set(["ctrl", "alt", "shift"]);
const ACTIONS = new Set(["moved", "edge", "passthrough", "ignore", "stale"]);

/** How many presses one terminal may have waiting. Only a held key while nvim is
 *  stalled can reach it; past that the newest press is dropped, not replayed late. */
export const NAV_BACKLOG_MAX = 8;
/** A queued press is dropped once its moment has passed by this much. */
export const NAV_PRESS_TTL_MS = 2000;

/** A direction press waiting for its turn.
 *  @typedef {{dir: string, at: number}} NavPress */

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

  /** @param {string} terminal @param {string} dir @returns {boolean} false when the backlog is full */
  push(terminal, dir) {
    const q = this.byTerminal.get(terminal) ?? [];
    if (q.length >= this.max) return false;
    q.push({ dir, at: Date.now() });
    this.byTerminal.set(terminal, q);
    return true;
  }

  /** The next press whose moment has not passed (expired ones are skipped).
   * @param {string} terminal @param {number} [now] @returns {NavPress | undefined} */
  shift(terminal, now = Date.now()) {
    const q = this.byTerminal.get(terminal);
    if (!q) return undefined;
    for (;;) {
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

/** A chord this code can turn into nvim notation: modifiers, then one key.
 *  Anything else is refused, so a stray shared or hand-edited value can never
 *  reach a request or keys.json unexpectedly.
 * @param {string} chord @returns {boolean} */
export function isChord(chord) {
  const parts = String(chord).toLowerCase().split("+");
  const tail = parts.pop() ?? "";
  return /^[a-z0-9]$/.test(tail) && parts.length > 0 && parts.every((p) => MODS.has(p));
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
 * Returns new keys.json text with the five splits-nav bindings applied:
 * the four direction chords and the settings chord, all in `global`. Any
 * leftover entry whose action targets splits-nav is dropped; everything else
 * is kept. Throws on invalid JSON, a `global` that isn't an object, or a chord
 * that isn't a plain modifier+key.
 * @param {string} text @param {Record<string, string>} [keys] @returns {string}
 */
export function mergeKeys(text, keys) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("keys.json 不是合法 JSON，未写入");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("keys.json 必须是对象");
  }
  if (obj.global === undefined) obj.global = {};
  if (!obj.global || typeof obj.global !== "object" || Array.isArray(obj.global)) {
    throw new Error("keys.json 的 global 段不是对象，未写入");
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
    if (!isChord(chord)) throw new Error(`非法 chord（${name}）：${chord}`);
  }
  const global = obj.global;
  for (const dir of DIRECTIONS) global[keysToJsonChord(merged[dir])] = `splits-nav.${dir}`;
  global[keysToJsonChord(merged.settings)] = "splits-nav.settings";
  return JSON.stringify(obj, null, 2) + "\n";
}

/** "ctrl+h" -> "<C-h>", "alt+h" -> "<A-h>" (nvim spelling).
 * @param {string} chord @returns {string} */
export function chordToLua(chord) {
  if (!isChord(chord)) throw new Error(`非法 chord：${chord}`);
  const parts = String(chord).toLowerCase().split("+");
  const tail = parts.pop() ?? "";
  const mods = parts.map((m) => LUA_MOD[m]);
  return "<" + [...mods, tail].join("-") + ">";
}

/** Where the nvim plugin advertises itself for one terminal: one file per
 *  terminal id, under <appHome>/splits-nav/.
 * @param {string} appHomeDir @param {string} terminalId @returns {string} */
export function discoveryPath(appHomeDir, terminalId) {
  return `${appHomeDir}/splits-nav/nvim-${terminalId}.json`;
}

/** One request line: {"op":"nav"|"wrap","dir":...,"keys":"<C-h>","terminal":...,
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
