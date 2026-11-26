// Pure rules for mounting this mod into every layout. No host imports, so node
// can test them directly (selftest.mjs).
//
// Herdr runs a mod only where a layout mounts it: without a copy of its own in
// the shown layout, the keys bound to `<mod>.<command>` reach nothing at all.
// So every personal layout gets one, added to the root's floats as a block that
// renders nothing. Herdr's own layouts are replaced whole on every start, so a
// write into one would be migrated to `<name>-edited` on the next start and
// re-injected forever (a new file and a toast each start); they are never
// written. For those, the keys are dead unless the person makes a personal copy.
//
// Idempotent by construction: a layout that already mounts the mod anywhere in
// its tree (block or float, however deep) is left untouched.

/** The mount this mod adds: a floating block, 0×0 because the mod draws nothing
 *  while docked. */
export const MOUNT = { id: "splits-nav", content: { mod: "splits-nav" }, peek: 0 };

/** Herdr's own layouts shipped today: the floor used when its ledger is
 *  missing or changes shape (the real list comes from shippedLayouts). */
export const SHIPPED = ["main", "terminals", "win98"];

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
    throw new Error("layout is not valid JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("layout is not an object");
  }
  if (!["row", "column", "stack", "block"].includes(obj.type) ||
      (obj.floating !== undefined && !Array.isArray(obj.floating))) {
    throw new Error("unrecognised layout structure");
  }
  if (hasMount(obj)) return null;
  const ids = new Set();
  /** @param {any} node */
  function collectIds(node) {
    ids.add(node.id);
    for (const child of [...(node.children ?? []), ...(node.floating ?? [])]) collectIds(child);
  }
  collectIds(obj);
  let id = MOUNT.id;
  for (let n = 2; ids.has(id); n++) id = `${MOUNT.id}-${n}`;
  obj.floating = [...(obj.floating ?? []), { ...MOUNT, id }];
  return JSON.stringify(obj, null, 2) + "\n";
}

/** The writes a layouts folder needs: one for every personal layout missing the
 *  mount. `expected` is what the file must still hold, so a concurrent edit
 *  fails the write instead of being clobbered. Empty when every layout is
 *  settled — the caller then writes nothing at all.
 * @param {{name: string, text: string | null}[]} files
 * @param {string[]} [shipped] Herdr's own layout names (see shippedLayouts)
 * @returns {{name: string, text: string, expected: string | null}[]} */
export function layoutPlan(files, shipped = SHIPPED) {
  const own = new Set(shipped);
  const out = [];
  for (const file of files.filter(f => f.text != null)) {
    if (own.has(file.name)) continue; // Herdr's own: never written
    /** @type {string | null} */
    let text = null;
    try {
      text = injectMount(file.text);
    } catch {
      continue; // not a layout we understand: leave it alone
    }
    if (text) out.push({ name: file.name, text, expected: file.text });
  }
  return out;
}