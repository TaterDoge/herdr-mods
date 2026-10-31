# Branches

在侧边栏里列出每个 space，名字后面跟着它当前所在的 git 分支，点一下切换过去。

![Branches](preview.png)

## What you see

一列垂直排列的行，边距 10px，行间距 4px，字号 13px。每行两个单元格，间距 8px：

- 左：space 名字。当前选中的 space 用 `foreground` 色，其余用 `muted`。
- 右：该 space 的 git 分支名，用 `dim` 色，浅色主题下自动换成深灰。
- 背景是主题的 `surface`，鼠标悬停时整行变成 `raised`。
- 一块空间不是 git 仓库时，右侧为空。

## How it behaves

- 点任意一行 → `run("space.select", { id })`，窗口切到那个 space。
- 悬停高亮，没有 agent 状态图标：状态由 `agents` mod 负责。
- 每 3 秒重读一次所有 space 的分支，`exec git branch --show-current`。
- 远程机器上的 space 在该机器上跑 git（`on: p.machine`），分支读不到时留空，不阻塞界面。

## Built from

- 一个 `mods/branches/` mod 文件夹，`main.js` 默认导出 `Branches extends View`。
- `mod.json` 是 `{ "place": "none", "title": "Branches" }`：不自动停靠，只在被布局或 `pane.split` 引用时出现。
- 数据：`spaces()`（`id`、`name`、`folder`、`machine`、`active`）、`theme()` 的 `surface` / `raised` / `foreground` / `muted` / `dim`。
- 命令：`space.select`。程序：`exec("git", ["branch", "--show-current"], { cwd, on })`。
- 刷新：`cx.timer.every(3000, …)` + `cx.spawn` + `cx.notify()`；不用 `setInterval`。
- 没有用到 shipped mod。

## Watch out

- 别用 `run("space.select", { index })` 代替 `id`：顺序会随排序变化。
- `spaces()` 每次读都复制对象，别在 `render` 里循环调用；一次读到局部变量。
- 每 3 秒对所有 space 跑一次 git：space 很多或仓库很大时会变慢，需要时把间隔调大。
- 机器离线时 `exec` 会失败并抛出，这里没有 try/catch，上一次的分支名会保留在 `this.branch` 里。
- `this.branch` 以 space id 为键，space 关闭后在界面上不再显示，键会留下；不影响正确性。

## Done when

- `herdr-app check ~/.config/herdr-app/mods/branches` 退出码 0，无输出。
- 用 `pane.split:right` 加 `{"mod": "branches"}` 或临时改布局把它放进窗口，能看到每个 space 一行、右侧有真实分支名。
- 点一行，窗口切到那个 space，它的名字变亮。
- 在某个 space 的仓库里 `git checkout` 到另一个分支，3 秒内右侧名字跟着变。