// Host-free carrier for the nvim half's install: runs the user's link-nvim
// script with `sh` (so a copied file can work even without its executable bit)
// and reports whether it changed something or failed. Kept free of host imports
// so selftest can drive it with fakes; main.js applies the window() guard (check
// has no window) and posts the notification.

/** Run the user's link-nvim once and summarize the outcome.
 * @param {(cmd: string, args: string[]) => Promise<{code: number, stdout: string, stderr: string}>} exec
 * @param {string} appHomeDir
 * @returns {Promise<{changed: boolean, error: string | null}>} */
export async function autoInstall(exec, appHomeDir) {
  const argv = [`${appHomeDir}/mods/splits-nav/link-nvim`];
  let out = await exec("sh", argv);
  if (out.code !== 0) {
    // Two docked copies can race the first `ln -s`: one wins, the other gets
    // "File exists" (exit 1) even though the link is now fine. Retry once;
    // a real conflict still fails again, so its error is kept.
    out = await exec("sh", argv);
  }
  if (out.code !== 0) {
    return { changed: false, error: out.stderr.trim() || `link-nvim 退出码 ${out.code}` };
  }
  // "linked:" / "relinking" mean the script changed the link; "already linked"
  // (which also contains "linked") means a working setup stays as it is.
  return { changed: /^(linked|relinking)/m.test(out.stdout), error: null };
}

/** What to notify for an autoInstall result: null when nothing changed, so a
 *  working setup stays quiet on every load.
 * @param {{changed: boolean, error: string | null}} result
 * @returns {{title: string, body: string, level: "info" | "error"} | null} */
export function linkNotify(result) {
  if (result.error) {
    return {
      title: "Splits Nav",
      body: "自动安装 nvim 插件失败：" + result.error + "，可手动运行 link-nvim 排查。",
      level: "error",
    };
  }
  if (result.changed) {
    return {
      title: "Splits Nav",
      body: "nvim 插件已自动安装，重启 nvim 后生效。",
      level: "info",
    };
  }
  return null;
}
