// Self-test for the nvim-half auto-install: install.js units with a fake
// exec, and the real link-nvim shell script against a temp HOME/
// NVIM_PLUGIN_DIR. Run: node splits-nav/mods/splits-nav/selftest-install.mjs
import { readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const modDir = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(new URL("./install.js", import.meta.url), "utf8");
const install = await import("data:text/javascript," + encodeURIComponent(src));

let failures = 0;
/** @param {string} name @param {unknown} cond @param {string} [extra] */
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

check("install: no host imports (check-safe)",
  !src.includes('from "herdr"') && !src.includes('from "gpui'));

// --- autoInstall: argv, outcome mapping, error propagation ---
/** @type {Array<[string, string[]]>} */
const argv = [];
const result = await install.autoInstall(async (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
  argv.push([cmd, args]);
  return { code: 0, stdout: "linked: /a -> /b\nrestart nvim to load herdr-nav\n", stderr: "" };
}, "/cfg/app");
check("autoInstall: runs sh with the absolute script path",
  argv.length === 1 && argv[0][0] === "sh" && argv[0][1].length === 1 &&
  argv[0][1][0] === "/cfg/app/mods/splits-nav/link-nvim");
check("autoInstall: changed when freshly linked", result.changed === true && result.error === null);

const again = await install.autoInstall(async () => ({
  code: 0, stdout: "already linked: /a -> /b\nrestart nvim to load herdr-nav\n", stderr: "",
}), "/x");
check("autoInstall: unchanged when already linked", again.changed === false && again.error === null);

const relink = await install.autoInstall(async () => ({
  code: 0, stdout: "relinking (was dangling): /a -> /old -> /b\nrestart nvim to load herdr-nav\n", stderr: "",
}), "/x");
check("autoInstall: changed on a dangling-link repair", relink.changed === true);

/** @type {Array<[string, string[]]>} */
const raceCalls = [];
const raced = await install.autoInstall(async (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
  raceCalls.push([cmd, args]);
  return raceCalls.length === 1
    ? { code: 1, stdout: "", stderr: "ln: ...: File exists\n" }
    : { code: 0, stdout: "already linked: /a -> /b\nrestart nvim to load herdr-nav\n", stderr: "" };
}, "/cfg/app");
check("autoInstall: retries once after a first-run race and accepts the retry",
  raced.changed === false && raced.error === null && raceCalls.length === 2 &&
  raceCalls[0][0] === "sh" && raceCalls[0][1][0] === raceCalls[1][1][0]);

let conflictCalls = 0;
const conflict = await install.autoInstall(async () => {
  conflictCalls++;
  return { code: 1, stdout: "", stderr: "skip: /b exists and is not a symlink; remove it first\n" };
}, "/x");
check("autoInstall: a real conflict still errors after the retry",
  conflict.changed === false && conflict.error.includes("skip") && conflictCalls === 2);

let rejected = false;
try {
  await install.autoInstall(async () => { throw new Error("sh: no such file"); }, "/x");
} catch {
  rejected = true;
}
check("autoInstall: rejects when the script cannot start", rejected);

// --- linkNotify: notify only when it matters ---
const nOk = install.linkNotify({ changed: true, error: null });
check("linkNotify: changed -> info asking to restart nvim",
  nOk && nOk.level === "info" && nOk.body.includes("restart nvim"));
check("linkNotify: unchanged -> null (no nagging on every load)",
  install.linkNotify({ changed: false, error: null }) === null);
const nErr = install.linkNotify({ changed: false, error: "skip: /b exists and is not a symlink; remove it first" });
check("linkNotify: failure -> actionable error", nErr && nErr.level === "error" && nErr.body.includes("skip"));

// --- the real link-nvim script, isolated in a temp HOME/NVIM_PLUGIN_DIR ---
const tmp = mkdtempSync(join(tmpdir(), "splits-nav-link-"));
const home = join(tmp, "home");
const pluginDir = join(tmp, "nvim-plugin");
mkdirSync(home, { recursive: true });
mkdirSync(pluginDir, { recursive: true });
// The sandbox has no process.env; give sh a standard PATH for /bin tools.
const env = { HOME: home, NVIM_PLUGIN_DIR: pluginDir, PATH: "/usr/bin:/bin" };
const script = join(modDir, "link-nvim");
const dest = join(pluginDir, "herdr-nav.lua");
const srcLua = join(modDir, "nvim", "plugin", "herdr-nav.lua");
/** @param {string} phase */
const runScript = (phase) => {
  const out = spawnSync("sh", [script], { encoding: "utf8", env });
  if (out.status !== 0) check(`script: ${phase} exits 0`, false, `status=${out.status} stderr=${out.stderr}`);
  return out;
};

rmSync(dest, { force: true });
const fresh = runScript("fresh install");
check("script: fresh install links and says so",
  fresh.stdout.includes("linked:") && readlinkSync(dest) === srcLua);

const repeat = runScript("repeat install");
check("script: repeat run leaves the link and says already linked",
  repeat.stdout.includes("already linked") && readlinkSync(dest) === srcLua);

rmSync(dest, { force: true });
symlinkSync("/nonexistent/nvim", dest);
const fixed = runScript("dangling repair");
check("script: repairs a dangling link", fixed.stdout.includes("relinking") && readlinkSync(dest) === srcLua);

rmSync(dest, { force: true });
writeFileSync(dest, "real file\n");
const blocked = spawnSync("sh", [script], { encoding: "utf8", env });
check("script: a real file in the way errors and is not overwritten",
  blocked.status === 1 && blocked.stderr.includes("skip") && blocked.stdout === "" &&
  readFileSync(dest, "utf8") === "real file\n");

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
