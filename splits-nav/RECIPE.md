# Splits Nav

`ctrl+h/j/k/l` 在 pane 之间移动，nvim 里是「先切 nvim 窗口，到边缘再切 herdr pane」。
附带设置对话框改按键。

![Splits Nav](preview.png)

## 你看到什么

平时什么都看不到：挂在托盘/布局里是这个 0×0 的块（`"place": "none"`），只负责收按键。
按设置键（默认 `ctrl-shift-h`）弹出一个 560px 宽的对话框（`overlay.dialog`），`popover` 背景、内边距 18、行距 10：

- 标题行：左边 “Splits Nav”（15px semibold），右边 “Esc”（11px dim）。
- 一行 11px dim 提示：“方向键按 keys.json 实际绑定读入；冲突以 keys() 为准，terminal 段优先于 global。”
- 五行设置（左/右/上/下/打开设置）：左边 64px 宽的 12px dim 标签，中间 26px 高、圆角 6 的按键按钮
  （12px medium，写当前键 + `▾`，冲突时边框和字用 `blocked` 红），右边 11px 说明（“可用”或冲突列表，`muted` 或红）。
- 底部右对齐两个 32px 高、圆角 8 的按钮：Apply（`solid` 实底）和 Close（`raised`）。
- 最下一行 18px 高的 11px 状态行：成功 `done` 绿，失败 `blocked` 红。

## 行为

- 焦点 pane 是普通程序（shell、agent…）→ 直接移 pane；zoomed 时先取消 zoom；没有邻居就 wrap。
- 焦点 pane 是 nvim → 通过 TCP 让 nvim 插件自己切窗口，nvim 回 `edge` 才回退成移 pane。
  不做终端字节注入；nvim 不可达时自动降级为移 pane。
- 设置键（默认 `ctrl+shift+h`）打开对话框，改 4 个方向键和设置键，带冲突检查，Apply 写 `keys.json`（先备份）。

## 安装

1. `scripts/link`（或用仓库根的 `scripts/link`，或把本文件夹的 `mods/splits-nav/` 复制到 `~/.config/herdr-app/mods/splits-nav/`）。热重载只认真目录，软链不生效。
2. 把本文件夹 `keys.json` 的 `global` 段合并进用户 `keys.json`，或用对话框 Apply。
3. nvim 半件：**由 agent 跑** `mods/splits-nav/link-nvim`（把 `nvim/plugin/herdr-nav.lua`
   软链进 `stdpath("config")/plugin`），然后重启 nvim。不往 lazy.nvim 里加插件条目、
   不改 nvim 配置：软链会解析回 `nvim/` 并自己加进 runtimepath。插件只在 herdr 终端里启动
   （需要 `HC_TERMINAL_ID`），终端外是空操作。
4. 布局里挂一个 floating 块：`{"id":"splits-nav","content":{"mod":"splits-nav"},"peek":0}`。

## 怎么搭的

- `main.js`：`View` 子类。没打开面板时 `render()` 返回 `div().w(0).h(0)`；`nextCommand()` 循环收
  `left`/`right`/`up`/`down`/`settings`/`probe`/`probe-geometry`，只有挂着的那份监听（第二份会抢命令）。
- `nav.js`：无副作用的纯函数——键位解析（`ctrl/alt/shift` 组合）、`mergeKeys` 合并 keys.json、
  发现文件路径与校验、请求编码/响应解码、`NavQueue`（每个 terminal 一条队列，容量满或超过 `NAV_PRESS_TTL_MS` 2000ms 就丢）。
- 导入：`gpui-kit`（`View`、`div`）、`gpui-base`（`v_flex`、`h_flex`）、
  `herdr`（`appHome`、`closeOverlay`、`focused`、`keys`、`nextCommand`、`notify`、`openOverlay`、
  `panes`、`props`、`readTextFile`、`run`、`theme`、`writeTextFile`）、`net`、`fs/promises`，同文件夹的 `./nav.js`。
  不 import 别的 mod，无第三方依赖，无构建。
- 用到的命令：`run("pane.go", { direction })` 移 pane、`run("pane.zoom")` 取消 zoom、`run("pane.focus")`；
  面板用 `openOverlay`/`closeOverlay`。
- nvim 半：`nvim/plugin/herdr-nav.lua` 在 `HC_TERMINAL_ID` 存在时启动 `nvim/lua/herdr-nav/server.lua`，
  在 127.0.0.1 上监听，把端口/pid 写进 `appHome()/splits-nav/nvim-<terminal>.json`；
  收到请求先在自己窗口里切，到边缘回 `edge`，mod 才移 pane。
- `nvim/plugin/herdr-nav.lua` 由 `link-nvim` 软链进 `stdpath("config")/plugin`，不经过任何包管理器；
  这个单元里也没有 `plugin/` 薄壳。
- `preview.png` 是设置对话框的真截图。

## 注意

- **碰网络、碰文件**：`net.connect("127.0.0.1", port)` 连 nvim；读发现文件；Apply 读改写
  `appHome()/keys.json`（先写 `keys.json.bak-<时间戳>`）；`probe` 写 `appHome()/splits-nav-probe.json`。
  除 `run()` 的 herdr 命令外不跑外部程序。
- 软链进 `~/.config/herdr-app/mods/` **不热重载**，改完要复制成真目录或重启 app，`status` 也不会报错。
- nvim 半和 keys.json 任缺一半都不报错，只默默退化成“移 pane”，很容易以为坏了；
  nvim 里请求 10s 超时（忙在长命令时会等），超时后才降级。
- `ctrl+h/j/k/l` 在 nvim 里本来有自己的含义，装了它就归 mod 管；`terminal` 段绑定优先于 `global`，
  别在两个段里重复绑同一键，冲突检查以 `keys()` 实际生效结果为准。
- 需要布局里有这个块（`{"id":"splits-nav","content":{"mod":"splits-nav"},"peek":0}`），否则没有东西收按键。

## 算做完的标准

- `herdr-app check mods/splits-nav` 退出码 0。
- `node mods/splits-nav/selftest.mjs` 最后一行 `all passed`（键位解析、JSON 往返、lua 转换、发现文件校验、请求/响应）。
- 设置键弹出对话框，五行都在；改一个键后 Apply 生成备份并写入 `keys.json`。
- nvim 里按 `ctrl+h` 先切 nvim 窗口，到最左窗口再按才移 herdr pane；不开 nvim 时按键直接移 pane。

## 写的文件

- `~/.config/herdr-app/splits-nav/nvim-<terminal>.json` —— nvim 插件的发现文件（端口/pid）。
- `~/.config/nvim/plugin/herdr-nav.lua` —— `link-nvim` 建的软链（实际路径跟随 `stdpath("config")`）。
- `~/.config/herdr-app/keys.json` —— Apply 改写，带 `keys.json.bak-<时间戳>` 备份。
- `~/.config/herdr-app/splits-nav-probe.json` —— `splits-nav.probe` 的排障快照。
