// Pure rules for mounting this mod into every layout. No host imports, so node
// can test them directly (selftest.mjs).
//
// Herdr runs a mod only where a layout mounts it: without a copy of its own in
// the shown layout, the keys bound to `<mod>.<command>` reach nothing at all.
// So every layout the person owns gets one, added to the root's floats as a
// block that renders nothing. Herdr's own layouts are replaced whole on every
// start, so a write into one would be migrated to `<name>-edited` on the next
// start and re-injected forever (a new file and a toast each start). For the
// ones this mod is for — Herdr ("main") and Terminals — a personal `<name>-nav`
// copy is made instead, once; Herdr's other layouts (Herdr 98, and any it ships
// later) are left alone.
//
// Idempotent by construction: a layout that already mounts the mod anywhere in
// its tree (block or float, however deep) is left untouched, and a copy is made
// only while nothing personal derives from that layout.

/** The mount this mod adds: a floating block, 0×0 because the mod draws nothing
 *  while docked. */
export const MOUNT = { id: "splits-nav", content: { mod: "splits-nav" }, peek: 0 };

/** Herdr's own layouts shipped today: the floor used when its ledger is
 *  missing or changes shape (the real list comes from shippedLayouts). */
export const SHIPPED = ["main", "terminals", "win98"];

/** The layouts Herdr owns that this mod works for and makes a copy of: Herdr
 *  ("main") and Terminals. Herdr 98 is a whole desktop driven by its own clicks,
 *  not by these keys, so it is left alone — add a name here if that changes. */
export const COPY_FOR = ["main", "terminals"];

/** Herdr's own layouts, read from its ledger (`installed.json` lists one
 *  `layout:<name>` entry per layout it ships, with that file's hash). Its own
 *  files are replaced whole on every start — and an edit migrates to
 *  `<name>-edited` — so they are never written: a copy is made instead.
 * @param {string | null} ledgerText
 * @returns {string[]} */
export function shippedLayouts(ledgerText) {
  /** @type {Set<string>} */
  const names = new Set(SHIPPED);
  try {
    const ledger = JSON.parse(ledgerText ?? "");
    for (const key of Object.keys(ledger ?? {})) {
      if (key.startsWith("layout:")) names.add(key.slice("layout:".length));
    }
  } catch {
    // no ledger to read: the floor above still holds
  }
  return [...names];
}

const MOD = MOUNT.content.mod;

/** Whether this node's subtree already mounts the mod — as a float or a block,
 *  at any depth.
 * @param {unknown} node @returns {boolean} */
export function hasMount(node) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasMount);
  const node2 = /** @type {{content?: any, children?: any, floating?: any}} */ (node);
  const content = node2.content;
  if (content && typeof content === "object" && content.mod === MOD) return true;
  return hasMount(node2.children) || hasMount(node2.floating);
}

/** The layout text with the mount added to the root's floats, or null when the
 *  layout already carries it (nothing to write). Throws when the text is not a
 *  layout object: the caller treats that as "not a layout we understand" and
 *  leaves the file alone.
 * @param {string} text @returns {string | null} */
export function injectMount(text) {
  /** @type {any} */
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("layout 不是合法 JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("layout 不是对象");
  }
  if (hasMount(obj)) return null;
  const floating = Array.isArray(obj.floating) ? obj.floating : [];
  obj.floating = [...floating, MOUNT];
  return JSON.stringify(obj, null, 2) + "\n";
}

/** The writes a layouts folder needs: one for every personal layout missing the
 *  mount, plus a `<name>-nav` copy for a layout Herdr owns, is in COPY_FOR, and
 *  nothing personal derives from yet. `expected` is what the file must still
 *  hold (null: it is new), so a concurrent edit fails the write instead of being
 *  clobbered. Empty when every layout is settled — the caller then writes
 *  nothing at all.
 * @param {{name: string, text: string | null}[]} files
 * @param {string[]} [shipped] Herdr's own layout names (see shippedLayouts)
 * @returns {{name: string, text: string, expected: string | null}[]} */
export function layoutPlan(files, shipped = SHIPPED) {
  const own = new Set(shipped);
  /** @type {Map<string, string>} */
  const have = new Map();
  for (const file of files) {
    if (file.text == null) continue;
    have.set(file.name, file.text);
  }
  /** Names some personal layout was cloned from. */
  const derived = new Set();
  for (const file of files) {
    if (file.text == null) continue;
    try {
      const from = JSON.parse(file.text)?.cloned_from?.name;
      if (typeof from === "string") derived.add(from);
    } catch {
      // junk: the per-file pass below skips it too
    }
  }
  /** @type {{name: string, text: string, expected: string | null}[]} */
  const out = [];
  for (const file of files) {
    if (file.text == null) continue;
    /** @type {string | null} */
    let text = null;
    try {
      text = injectMount(file.text);
    } catch {
      continue; // not a layout we understand: leave it alone
    }
    if (file.name && own.has(file.name)) {
      // Herdr's own: never written. Copy only the layouts this mod is for.
      if (!COPY_FOR.includes(file.name)) continue;
      const copy = file.name + "-nav";
      if (derived.has(file.name) || have.has(copy)) continue;
      out.push({ name: copy, text: text ?? file.text, expected: null });
      continue;
    }
    if (text) out.push({ name: file.name, text, expected: file.text });
  }
  return out;
}