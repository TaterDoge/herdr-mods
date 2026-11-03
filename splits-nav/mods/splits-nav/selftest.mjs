// Self-test for nav.js. Run: node splits-nav/mods/splits-nav/selftest.mjs
import { readFileSync } from "node:fs";

// nav.js is an ESM module but this folder has no package.json, so node
// would parse it as CommonJS. Import it as a data URL to force ESM.
const src = readFileSync(new URL("./nav.js", import.meta.url), "utf8");
const nav = await import("data:text/javascript," + encodeURIComponent(src));

let failures = 0;
/** @param {string} name @param {unknown} cond @param {string} [extra] */
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

/** Parses a merge result; a parse error is itself a failure, not a crash.
 * @param {string} text @returns {any} */
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    check("output parses as JSON", false, String(e));
    return {};
  }
};

/** @param {() => unknown} fn @returns {boolean} */
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/** Runs mergeKeys; a throw is a named failure, not a crash.
 * @param {string} text @param {Record<string, string>} [keys] @returns {string} */
const merge = (text, keys) => {
  try {
    return nav.mergeKeys(text, keys);
  } catch (e) {
    check("mergeKeys accepts the sample", false, String(e));
    return "{}";
  }
};

const SAMPLE = JSON.stringify({
  global: { "cmd-q": "app.quit", "ctrl-shift-x": "splits-nav.home" },
  terminal: { "cmd-c": "terminal.copy" },
}, null, 2) + "\n";

// --- chords ---
check("chord: accepts ctrl/alt/shift forms",
  nav.isChord("ctrl+h") && nav.isChord("alt+k") && nav.isChord("ctrl+shift+h"));
check("chord: rejects junk and injection",
  !nav.isChord("") && !nav.isChord("h") && !nav.isChord("hyper+h") &&
  !nav.isChord('ctrl+x"; os.execute("id") --') && !nav.isChord("ctrl+ab"));
check("chord: keys.json spelling round-trips",
  nav.chordFromJsonChord(nav.keysToJsonChord("alt+shift+k")) === "alt+shift+k");

// --- mergeKeys ---
const m = parse(merge(SAMPLE, {}));
check("merge: JSON round-trips", typeof m === "object" && Array.isArray(m) === false);
check("merge: preserves unrelated global keys", m.global["cmd-q"] === "app.quit");
check("merge: preserves other sections", m.terminal["cmd-c"] === "terminal.copy");
check("merge: drops old splits-nav entry", !Object.hasOwn(m.global, "ctrl-shift-x"));
check("merge: writes 4 directions with defaults",
  m.global["ctrl-h"] === "splits-nav.left" &&
  m.global["ctrl-l"] === "splits-nav.right" &&
  m.global["ctrl-k"] === "splits-nav.up" &&
  m.global["ctrl-j"] === "splits-nav.down");
check("merge: writes settings key", m.global["ctrl-shift-h"] === "splits-nav.settings");

const ms = parse(merge(SAMPLE, { settings: "alt+shift+h" }));
check("merge: honors custom settings chord",
  ms.global["alt-shift-h"] === "splits-nav.settings" && !Object.hasOwn(ms.global, "ctrl-shift-h"));

const mc = parse(merge(SAMPLE, { left: "alt+h", up: "alt+k" }));
check("merge: honors custom chords",
  mc.global["alt-h"] === "splits-nav.left" && mc.global["alt-k"] === "splits-nav.up");
check("merge: keeps defaults for unset directions", mc.global["ctrl-l"] === "splits-nav.right");
check("merge: removes any leftover splits-nav action (not just ours)",
  !Object.entries(mc.global).some(([k, a]) => String(a).startsWith("splits-nav.")
    && !["alt-h", "alt-k", "ctrl-h", "ctrl-j", "ctrl-k", "ctrl-l", "alt-shift-h", "ctrl-shift-h"].includes(k)));
check("merge: throws on invalid JSON", throws(() => nav.mergeKeys("{ not json", {})));
check("merge: refuses a non-object global instead of resetting it",
  throws(() => nav.mergeKeys('{"global": null}', {})));
check("merge: refuses a bad chord", throws(() => nav.mergeKeys(SAMPLE, { left: 'ctrl+x"; os.execute("id") --' })));

// --- nvim notation ---
check("lua: ctrl+h -> <C-h>", nav.chordToLua("ctrl+h") === "<C-h>");
check("lua: alt+shift+h -> <A-S-h>", nav.chordToLua("alt+shift+h") === "<A-S-h>");
check("lua: refuses a bad chord", throws(() => nav.chordToLua('ctrl+j" .. os.execute("id") .. "')));

// --- discovery protocol ---
check("discovery: path under appHome/splits-nav",
  nav.discoveryPath("/a/app", "t31") === "/a/app/splits-nav/nvim-t31.json");
const req = parse(nav.encodeRequest("nav", "left", "<C-h>", "t31", 42));
check("request: nav op/dir/keys/terminal/pid",
  req.op === "nav" && req.dir === "left" && req.keys === "<C-h>" &&
  req.terminal === "t31" && req.pid === 42);
check("response: parses moved with t", (() => {
  const r = nav.decodeResponse('{"action":"moved","t":{"rx":1,"tx":2}}');
  return r && r.action === "moved" && r.t.rx === 1 && r.t.tx === 2;
})());
check("response: rejects garbage", nav.decodeResponse("nope") === null && nav.decodeResponse('["x"]') === null);
check("response: rejects a stray object (a key must not be swallowed)",
  nav.decodeResponse('{"ok":1}') === null && nav.decodeResponse('{"action":"weird"}') === null);
check("discovery: accepts our own file", (() => {
  const d = nav.discoveryInfo('{"schema":1,"terminal":"t31","port":4321,"pid":9}', "t31");
  return d && d.port === 4321 && d.pid === 9;
})());
check("discovery: refuses another terminal's file",
  nav.discoveryInfo('{"schema":1,"terminal":"t9","port":1,"pid":9}', "t31") === null);
check("discovery: refuses bad schema/port/pid/junk",
  nav.discoveryInfo('{"schema":2,"terminal":"t31","port":1,"pid":9}', "t31") === null &&
  nav.discoveryInfo('{"schema":1,"terminal":"t31","port":"x","pid":9}', "t31") === null &&
  nav.discoveryInfo('{"schema":1,"terminal":"t31","port":1}', "t31") === null &&
  nav.discoveryInfo("junk", "t31") === null && nav.discoveryInfo(null, "t31") === null);
check("reverse: left<->right and up<->down",
  nav.REVERSE_DIRECTIONS.left === "right" && nav.REVERSE_DIRECTIONS.right === "left" &&
  nav.REVERSE_DIRECTIONS.up === "down" && nav.REVERSE_DIRECTIONS.down === "up");
check("response: accepts stale as its own verdict", (() => {
  const r = nav.decodeResponse('{"action":"stale"}');
  return r !== null && r.action === "stale";
})());

// --- press queue ---
check("queue: keeps presses in order up to the cap", (() => {
  const q = new nav.NavQueue(2);
  const pushed = q.push("t1", "left") && q.push("t1", "right") && !q.push("t1", "up");
  return pushed && q.shift("t1").dir === "left" && q.shift("t1").dir === "right" &&
    q.shift("t1") === undefined;
})());
check("queue: per terminal and cleaned up when empty", (() => {
  const q = new nav.NavQueue();
  q.push("t1", "left");
  q.push("t2", "right");
  return q.pending("t1") === 1 && q.pending("t2") === 1 && q.shift("t2").dir === "right" &&
    q.pending("t2") === 0 && q.pending("t1") === 1 && q.shift("t1").dir === "left";
})());
check("queue: drops a queued press whose moment has passed", (() => {
  const q = new nav.NavQueue();
  q.push("t1", "left");
  return q.shift("t1", Date.now() + 5000) === undefined && q.pending("t1") === 0;
})());

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
