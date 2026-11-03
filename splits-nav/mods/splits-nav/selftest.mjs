// Self-test for nav.js. Run: node splits-nav/mods/splits-nav/selftest.mjs
import { readFileSync } from "node:fs";

// nav.js is an ESM module but this folder has no package.json, so node
// would parse it as CommonJS. Import it as a data URL to force ESM.
const src = readFileSync(new URL("./nav.js", import.meta.url), "utf8");
const nav = await import("data:text/javascript," + encodeURIComponent(src));
const lsrc = readFileSync(new URL("./layouts.js", import.meta.url), "utf8");
const layouts = await import("data:text/javascript," + encodeURIComponent(lsrc));

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
  global: { "cmd-q": "app.quit", "ctrl-shift-x": "splits-nav.home", "ctrl-shift-h": "splits-nav.settings" },
  terminal: { "cmd-c": "terminal.copy" },
}, null, 2) + "\n";

// --- chords ---
check("chord: accepts ctrl/alt/shift forms",
  nav.isChord("ctrl+h") && nav.isChord("alt+k") && nav.isChord("cmd+shift+s"));
check("chord: rejects junk and injection",
  !nav.isChord("") && !nav.isChord("h") && !nav.isChord("hyper+h") &&
  !nav.isChord('ctrl+x"; os.execute("id") --') && !nav.isChord("ctrl+ab"));
check("chord: keys.json spelling round-trips",
  nav.chordFromJsonChord(nav.keysToJsonChord("alt+shift+k")) === "alt+shift+k");
check("chord: accepts modifier + a direction key",
  nav.isChord("ctrl+left") && nav.isChord("alt+up") &&
  nav.isChord("ctrl+shift+right") && nav.isChord("alt+down"));
check("chord: still refuses a bare or shifted direction",
  !nav.isChord("left") && !nav.isChord("shift+left") && !nav.isChord("hyper+left") &&
  !nav.isChord("ctrl+arrowleft") && !nav.isChord("ctrl+pageup"));
check("chord: prototype-chain names are not keys",
  !nav.isChord("ctrl+constructor") && !nav.isChord("ctrl+toString") &&
  !nav.isChord("ctrl+__proto__"));
check("chord: direction keys.json spelling round-trips",
  nav.keysToJsonChord("ctrl+left") === "ctrl-left" &&
  nav.chordFromJsonChord("ctrl-left") === "ctrl+left");

// --- chordFromKeystroke ---
check("keystroke: accepts ctrl-h -> ctrl+h",
  nav.chordFromKeystroke("ctrl-h") === "ctrl+h");
check("keystroke: accepts alt-k -> alt+k",
  nav.chordFromKeystroke("alt-k") === "alt+k");
check("keystroke: accepts ctrl-shift-h -> ctrl+shift+h",
  nav.chordFromKeystroke("ctrl-shift-h") === "ctrl+shift+h");
check("keystroke: accepts alt-shift-j -> alt+shift+j",
  nav.chordFromKeystroke("alt-shift-j") === "alt+shift+j");
check("keystroke: canonical order shift-ctrl-h -> ctrl+shift+h",
  nav.chordFromKeystroke("shift-ctrl-h") === "ctrl+shift+h");
check("keystroke: rejects cmd-s", nav.chordFromKeystroke("cmd-s") === null);
check("keystroke: cmd is allowed only when the row asks for it",
  nav.chordFromKeystroke("shift-cmd-s", true) === "cmd+shift+s" &&
  nav.chordFromKeystroke("cmd-shift-s", true) === "cmd+shift+s" &&
  nav.chordFromKeystroke("cmd-shift-s") === null);
check("keystroke: rejects shift-only", nav.chordFromKeystroke("shift-h") === null);
check("keystroke: rejects a bare key", nav.chordFromKeystroke("h") === null);
check("keystroke: rejects escape", nav.chordFromKeystroke("escape") === null);
check("keystroke: rejects navigation keys",
  nav.chordFromKeystroke("left") === null && nav.chordFromKeystroke("pageup") === null);
check("keystroke: rejects function keys",
  nav.chordFromKeystroke("f5") === null && nav.chordFromKeystroke("ctrl-pageup") === null);
check("keystroke: rejects modifiers-only", nav.chordFromKeystroke("ctrl-shift") === null);
check("keystroke: rejects empty", nav.chordFromKeystroke("") === null);
check("keystroke: rejects hyper", nav.chordFromKeystroke("hyper+h") === null);
check("keystroke: accepts direction keys",
  nav.chordFromKeystroke("ctrl-left") === "ctrl+left" &&
  nav.chordFromKeystroke("alt-shift-down") === "alt+shift+down");
check("keystroke: still refuses a bare or shifted direction",
  nav.chordFromKeystroke("shift-left") === null && nav.chordFromKeystroke("left") === null &&
  nav.chordFromKeystroke("cmd-left") === null && nav.chordFromKeystroke("ctrl-arrowleft") === null);

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
check("merge: writes 4 resize commands with defaults",
  m.global["alt-h"] === "splits-nav.resize-left" &&
  m.global["alt-l"] === "splits-nav.resize-right" &&
  m.global["alt-k"] === "splits-nav.resize-up" &&
  m.global["alt-j"] === "splits-nav.resize-down");
check("merge: writes the settings key and drops the old one",
  m.global["cmd-shift-s"] === "splits-nav.settings" && !Object.hasOwn(m.global, "ctrl-shift-h"));

const ms = parse(merge(SAMPLE, { settings: "alt+shift+h" }));
check("merge: honors custom settings chord",
  ms.global["alt-shift-h"] === "splits-nav.settings" && !Object.hasOwn(ms.global, "cmd-shift-s"));

const mc = parse(merge(SAMPLE, { left: "alt+h", up: "alt+k", "resize-left": "ctrl+u", "resize-up": "ctrl+i" }));
check("merge: honors custom chords",
  mc.global["alt-h"] === "splits-nav.left" && mc.global["alt-k"] === "splits-nav.up");
check("merge: honors custom resize chords",
  mc.global["ctrl-u"] === "splits-nav.resize-left" && mc.global["ctrl-i"] === "splits-nav.resize-up");
check("merge: keeps defaults for unset directions", mc.global["ctrl-l"] === "splits-nav.right");
check("merge: a captured direction chord lands in keys.json", (() => {
  const out = parse(merge(SAMPLE, { left: "ctrl+left" }));
  return out.global["ctrl-left"] === "splits-nav.left";
})());
check("merge: a captured chord lands in keys.json", (() => {
  const chord = nav.chordFromKeystroke("ctrl-shift-1");
  const out = parse(merge(SAMPLE, { left: chord }));
  return chord !== null && out.global["ctrl-shift-1"] === "splits-nav.left";
})());
check("merge: removes any leftover splits-nav action (not just ours)",
  !Object.entries(mc.global).some(([k, a]) => String(a).startsWith("splits-nav.")
    && !["alt-h", "alt-k", "ctrl-h", "ctrl-j", "ctrl-k", "ctrl-l",
      "alt-j", "alt-l", "ctrl-u", "ctrl-i", "alt-shift-h", "cmd-shift-s"].includes(k)));
check("merge: throws on invalid JSON", throws(() => nav.mergeKeys("{ not json", {})));
check("merge: refuses a non-object global instead of resetting it",
  throws(() => nav.mergeKeys('{"global": null}', {})));
check("merge: refuses a bad chord", throws(() => nav.mergeKeys(SAMPLE, { left: 'ctrl+x"; os.execute("id") --' })));

// --- nvim notation ---
check("lua: ctrl+h -> <C-h>", nav.chordToLua("ctrl+h") === "<C-h>");
check("lua: alt+shift+h -> <A-S-h>", nav.chordToLua("alt+shift+h") === "<A-S-h>");
check("lua: direction keys use nvim's names",
  nav.chordToLua("ctrl+left") === "<C-Left>" && nav.chordToLua("alt+up") === "<A-Up>" &&
  nav.chordToLua("ctrl+shift+right") === "<C-S-Right>");
check("lua: cmd is a chord but never nvim notation",
  nav.isChord("cmd+h") && throws(() => nav.chordToLua("cmd+h")) &&
  throws(() => nav.chordToLua("cmd+shift+s")));
check("lua: still refuses an unnamed key", throws(() => nav.chordToLua("ctrl+pageup")));
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
// --- isFreshRecording ---
check("fresh: a fresh object marker is fresh",
  nav.isFreshRecording({ at: 1000 }, 1500, 2000) === true);
check("fresh: an expired marker is stale",
  nav.isFreshRecording({ at: 1000 }, 3000, 2000) === false);
check("fresh: a string marker is stale",
  nav.isFreshRecording("left", 1500, 2000) === false);
check("fresh: null is stale",
  nav.isFreshRecording(null, 1500, 2000) === false);

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

// --- layout mounting (the rules behind plantLayouts) ---
/** @param {string} text @returns {any} */
const layout = (text) => parse(text);
const plain = JSON.stringify({ id: "root", type: "row", children: [{ id: "main", type: "block" }] }, null, 2) + "\n";
const personal = JSON.stringify({
  id: "root", type: "row", cloned_from: { name: "main", version: "0.1.10" },
  children: [{ id: "main", type: "block" }],
  floating: [{ id: "splits-nav", content: { mod: "splits-nav" }, peek: 0 }],
}, null, 2) + "\n";
const nested = JSON.stringify({
  id: "root", type: "row",
  children: [{ id: "left", type: "column", floating: [{ id: "x", content: { mod: "splits-nav" } }] }],
}, null, 2) + "\n";
const asBlock = JSON.stringify({
  id: "root", type: "row",
  children: [{ id: "main", type: "block", content: { mod: "splits-nav" } }],
}, null, 2) + "\n";
check("layouts: sees the mount as a float, nested, or a block",
  layouts.hasMount(layout(personal)) && layouts.hasMount(layout(nested)) &&
  layouts.hasMount(layout(asBlock)) && !layouts.hasMount(layout(plain)));

check("layouts: inject adds one 0-size float and keeps the tree", (() => {
  const out = layouts.injectMount(plain);
  const obj = layout(out);
  return obj.children.length === 1 && obj.children[0].id === "main" &&
    obj.floating.length === 1 && obj.floating[0].content.mod === "splits-nav" &&
    obj.floating[0].peek === 0;
})());
check("layouts: inject is idempotent (second run writes nothing)", (() => {
  const once = layouts.injectMount(plain);
  return layouts.injectMount(once) === null && layouts.injectMount(personal) === null;
})());
check("layouts: inject refuses junk instead of writing it",
  throws(() => layouts.injectMount("{ not json")) && throws(() => layouts.injectMount("[1,2]")));

/** A personal layout of the person's own, no clone, still without the mount. */
const mine = JSON.stringify({ id: "root", type: "row", children: [{ id: "work", type: "block" }] }, null, 2) + "\n";
/** @type {{name: string, text: string, expected: string | null}[]} */
const plan = layouts.layoutPlan([
  { name: "main", text: plain },
  { name: "main-mine", text: personal },
  { name: "terminals", text: plain },
  { name: "win98", text: plain },
  { name: "my-layout", text: mine },
  { name: "broken", text: "{ not json" },
  { name: "gone", text: null },
]);
check("plan: fills the personal ones and copies only for Herdr/Terminals",
  plan.length === 2 && plan.map((w) => w.name).join(",") === "terminals-nav,my-layout" &&
  !plan.some((w) => w.name.startsWith("win98")));
check("plan: in-place writes expect the old text, copies must be new",
  plan.find((w) => w.name === "my-layout")?.expected === mine &&
  plan.find((w) => w.name === "terminals-nav")?.expected === null &&
  !plan.some((w) => w.name === "main" || w.name === "main-mine" || w.name === "win98"));
check("plan: the injected copy carries the mount and the original tree", (() => {
  const copy = layout(plan.find((w) => w.name === "terminals-nav").text);
  return copy.children.length === 1 && layouts.hasMount(copy);
})());
check("plan: the filled-in personal layout keeps its own tree", (() => {
  const filled = layout(plan.find((w) => w.name === "my-layout").text);
  return filled.children[0].id === "work" && layouts.hasMount(filled);
})());
/** A layout set where a personal clone already exists for the one shipped one. */
/** @type {{name: string, text: string, expected: string | null}[]} */
const derivedPlan = layouts.layoutPlan([
  { name: "main", text: plain },
  { name: "main-mine", text: personal },
]);
check("plan: a clone of a shipped layout means no copy for it",
  !derivedPlan.some((w) => w.name === "main-nav"));
check("plan: second run writes nothing at all (an old win98-nav copy is left as it is)",
  layouts.layoutPlan([
    { name: "main", text: plain },
    { name: "main-mine", text: personal },
    { name: "terminals", text: plain },
    { name: "terminals-nav", text: layouts.injectMount(plain) },
    { name: "win98", text: plain },
    { name: "win98-nav", text: layouts.injectMount(plain) },
    { name: "my-layout", text: layouts.injectMount(mine) },
  ]).length === 0);
check("plan: skips files it cannot read or parse",
  layouts.layoutPlan([{ name: "broken", text: "{ not json" }, { name: "gone", text: null }]).length === 0);

check("layouts: Herdr's own layouts come from its ledger", (() => {
  const ledger = '{"layout:main":{"json":"x"},"layout:my-layout":{"json":"x"},"agents":{"main.js":"x"}}';
  const own = layouts.shippedLayouts(ledger);
  return own.includes("my-layout") && own.includes("main") && own.includes("terminals") &&
    !own.includes("agents") && !own.includes("main-mine");
})());
check("layouts: a missing or odd ledger keeps the known names",
  layouts.shippedLayouts(null).includes("terminals") &&
  layouts.shippedLayouts("not json").includes("win98") &&
  layouts.shippedLayouts('{"main":1}').includes("main"));
/** @type {{name: string, text: string, expected: string | null}[]} */
const ownedPlan = layouts.layoutPlan([
  { name: "main", text: plain },
  { name: "future", text: plain },
], layouts.shippedLayouts('{"layout:main":{"json":"x"},"layout:future":{"json":"x"}}'));
check("plan: a layout the ledger owns and this mod is for gets a copy, never an edit",
  ownedPlan.length === 1 && ownedPlan[0].name === "main-nav" && ownedPlan[0].expected === null);
/** @type {{name: string, text: string, expected: string | null}[]} */
const otherOwnPlan = layouts.layoutPlan(
  [{ name: "win98", text: plain }],
  layouts.shippedLayouts('{"layout:win98":{"json":"x"}}'));
check("plan: a ledger-owned layout outside COPY_FOR is left alone",
  otherOwnPlan.length === 0);
/** @type {{name: string, text: string, expected: string | null}[]} */
const mixedPlan = layouts.layoutPlan([
  { name: "main", text: plain },
  { name: "mine", text: mine },
], layouts.shippedLayouts('{"layout:main":{"json":"x"}}'));
check("plan: a layout the ledger does not own is edited in place",
  mixedPlan.length === 2 && mixedPlan.find((w) => w.name === "mine")?.expected === mine &&
  mixedPlan.find((w) => w.name === "main-nav")?.expected === null);

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
