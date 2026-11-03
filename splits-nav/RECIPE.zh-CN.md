# Splits Nav

[English](RECIPE.md)

`ctrl+h/j/k/l` 在 pane 之间移动，`alt+h/j/k/l` 调整大小；nvim 里是「先切/先调 nvim 窗口，
铺满终端时再操作 herdr pane」。附带设置对话框改按键。

![Splits Nav](preview.png)

## 你看到什么

平时什么都看不到：挂在托盘/布局里是这个 0×0 的块（`"place": "none"`），只负责收按键。
按设置键（默认 `cmd-shift-s`）弹出一个 560px 宽的对话框（`overlay.dialog`），`popover` 背景、内边距 18、行距 10：

- 标题行：左边 “Splits Nav”（15px semibold），右边 “Esc”（11px dim）。
- 一行 11px dim 提示：“点按键然后按下要用的键（Esc 取消）：只认 ctrl/alt/shift + 一个字母、数字或方向键，且必须带 ctrl 或 alt（打开设置那行还认 cmd）。方向/resize 键要能转成 nvim 记法；冲突以 keys() 为准，terminal 段优先于 global。”
- 九行（4 方向 + 4 resize + 设置）：左边 64px 宽的 12px dim 标签，中间 26px 高、圆角 6 的按键按钮
  （12px medium，闲时写当前键 + `▾`，录入中显示“按下按键…”，冲突时边框和字用 `blocked` 红），
  右边 11px 说明（“可用”、冲突列表或录入提示，`muted` 或红）。
- 底部右对齐两个 32px 高、圆角 8 的按钮：Apply（`solid` 实底）和 Close（`raised`）。
- 最下一行 18px 高的 11px 状态行：成功 `done` 绿，失败 `blocked` 红。

## 行为

- 焦点 pane 是普通程序（shell、agent…）→ 直接移 pane；zoomed 时先取消 zoom；没有邻居就 wrap。
- 焦点 pane 是 nvim → 通过 TCP 让 nvim 插件自己切窗口，nvim 回 `edge` 才回退成移 pane。
  不做终端字节注入；nvim 不可达时自动降级为移 pane。
- resize（`alt+h/j/k/l`）：nvim 里先调 nvim 自己的 split（每次 3 列，±号按窗口在布局中的位置算，
  同 herdr-splits.nvim），nvim 侧无邻居（回 `edge`）才调 herdr pane；普通 pane 直接调 herdr pane。
  herdr pane 的尺寸只能走 `run("layout.resize")`（app 没有 pane.resize 命令；pane 就是运行时布局节点，
  id 就是 pane id）：先 `pane.go` 探一下同方向/反方向有没有邻居（探完把焦点还回去）定增减，
  再用 `hc get <terminal>` 读双方的格子数当权重（3% 一格），改两个 pane 的 weight。
  方向语义同参考实现：那侧的边框往外让给自己就变大，反过来挤到自己就变小；没有邻居则不动。
- 设置键（默认 `cmd+shift+s`）打开对话框，改 8 个方向/resize 键和设置键：点行的按键按钮进入
  录入，直接按下新键（Esc 取消；只认 ctrl/alt/shift + 一个字母、数字或方向键，且必须带 ctrl 或 alt；打开设置那行还认 cmd），带冲突检查，
  Apply 写 `keys.json`。
- 挂载：mod 只在「布局里挂了它」的地方跑，命令只到当前布局里活着的那份。所以 init 会往
  每份个人布局里补一块 0×0 floating；Herdr 自带的布局每次启动被重写（写了会变成 `<名>-edited`
  并反复重建），所以对 `COPY_FOR` 里那两个——Herdr（`main`）和 Terminals——各做一份 `<名>-nav`
  副本（已有克隆、或副本已存在就不做）；Herdr 其它自带布局（Herdr 98 等）不动（它自己的点击驱动，
  用不上这些键）。

## 安装

1. 用仓库根的 `scripts/link`，或把本文件夹的 `mods/splits-nav/` 复制成
   `~/.config/herdr-app/mods/splits-nav/`。热重载只认真目录，软链不生效。
2. 把本文件夹 `keys.json` 的 `global` 段合并进用户 `keys.json`，或用对话框 Apply。
3. nvim 半件：**自动配置**。mod 首次在真实 app 窗口加载时（布局里挂载了本块，不是
   `herdr-app check`、也不是 Customize 复制文件时），自动执行一次 `link-nvim`：把
   `nvim/plugin/herdr-nav.lua` 软链进 `~/.config/nvim/plugin`，并提示重启 nvim。
   不往 lazy.nvim 里加插件条目、不改 nvim 配置：软链会解析回 `nvim/` 并自己加进
   runtimepath。插件只在 herdr 终端里启动（需要 `HC_TERMINAL_ID`），终端外是空操作。
   链接已存在且有效时不重复提醒；链接失效会自动修复；有普通文件顶住会报错退出，需手动
   移除该文件后重载。默认链接到 `~/.config/nvim/plugin`，可用 `NVIM_PLUGIN_DIR`
   改位置。更新 mod 后重启现有 nvim 才用新版。自动配置依赖 POSIX sh，无 sh 时报错，
   需手动运行 `link-nvim`。默认假定 nvim 配置在 `~/.config/nvim`；Windows 或自定义
   `XDG_CONFIG_HOME` 时请设置 `NVIM_PLUGIN_DIR`，否则 nvim 可能不会读取该目录。
4. 布局：**自动挂载**。mod 首次在真实窗口加载时（不是 `herdr-app check`）扫描
   `layouts/*.json`：没有挂载它的布局就补上一块 floating（`layoutPlan`）。Herdr 自带的布局
   （读它的账本 `installed.json` 里的 `layout:<名>` 条目，兼当下已知的三个名字）**永不写**——
   它们每次启动被整体重写，写了会被搬到 `<名>-edited` 并反复重建；改为给 `COPY_FOR`
   （Herdr `main` + Terminals）各建一份一次性的 `terminals-nav`（`<名>-nav`），且只在没有别的布局用
   `cloned_from` 指向它时才建。Herdr 98 不做兼容（它自己的点击驱动，不用这些键）。
   幂等：已挂载的布局一字不改，副本建过就不再写；新建副本时提示一次。
   切到那两份副本（Herdr 那份 / Terminals 那份）就能用那些键（自带原文件本身改不了：
   Herdr/Terminals 靠副本，Herdr 98 不做兼容）。

## 怎么搭的

- `main.js`：`View` 子类。没打开面板时 `render()` 返回 `div().w(0).h(0)`；`nextCommand()` 循环收
  `left`/`right`/`up`/`down`/`settings`/`probe`/`probe-geometry`，只有挂着的那份监听（第二份会抢命令）。
  挂载的那份 init 里顺带跑 `autoInstallLinkNvim()`：`window()` 非空（真实窗口，非 check）时用
  `exec("sh", [script])` 跑 `link-nvim`，有变化才提示重启 nvim，失败报错；不阻塞按键。
  `install.js` 是无宿主导入的纯编排（传给 fake exec 可单测），通知文案也在那里。
  同一处还跑 `plantLayouts()`：读 `layouts/*.json`，交给 `layoutPlan` 算出要写什么（缺挂载的
  个人布局原地补 floating；`COPY_FOR` 里的自带布局做 `<名>-nav` 副本），`writeTextFile` 带上读到的原文本做
  并发保护；没有要写的就一个字节不写。两件都只跑一次、失败只报一次。
- `layouts.js`：无宿主导入的纯函数——`MOUNT`（那块 0×0 floating）、`SHIPPED`（兜底名单）、
  `shippedLayouts`（从账本 json 取 `layout:<名>`）、
  `hasMount`（整棵树里当 block 或 float 挂过都算）、`injectMount`（已有返回 null，非 JSON 抛错）、
  `layoutPlan`（要写的文件与 expected；空数组＝什么都不用干）。selftest 直接驱动这些。
- `nav.js`：无副作用的纯函数——键位解析（`ctrl/alt/shift` 组合）、`mergeKeys` 合并 keys.json、
  发现文件路径与校验、请求编码/响应解码、`NavQueue`（每个 terminal 一条队列，容量满或超过 `NAV_PRESS_TTL_MS` 2000ms 就丢）。
- 导入：`gpui-kit`（`View`、`div`）、`gpui-base`（`v_flex`、`h_flex`）、
  `herdr`（`appHome`、`closeOverlay`、`exec`、`focused`、`keys`、`nextCommand`、`notify`、
  `openOverlay`、`panes`、`props`、`readTextFile`、`run`、`setShared`、`shared`、`theme`、`window`、`writeTextFile`）、
  `net`、`fs/promises`，同文件夹的 `./nav.js`、`./install.js`、`./layouts.js`。
  不 import 别的 mod，无第三方依赖，无构建。
- 用到的命令：`run("pane.go", { direction })` 移 pane、`run("pane.zoom")` 取消 zoom、`run("pane.focus")`；
  resize 用 `run("layout.resize", { id, weight })` 按 pane id 改权重，尺寸先由 `exec("hc", ["get", terminal])`
  读格子数；面板用 `openOverlay`/`closeOverlay`。
- nvim 半：`nvim/plugin/herdr-nav.lua` 在 `HC_TERMINAL_ID` 存在时启动 `nvim/lua/herdr-nav/server.lua`，
  在 127.0.0.1 上监听，把端口/pid 写进 `appHome()/splits-nav/nvim-<terminal>.json`；
  收到请求先在自己窗口里切，到边缘回 `edge`，mod 才移 pane。
- `nvim/plugin/herdr-nav.lua` 由 `link-nvim` 软链进 `~/.config/nvim/plugin`
  （或 `NVIM_PLUGIN_DIR`），不经过任何包管理器；这个单元里也没有 `plugin/` 薄壳。
- `preview.png` 是设置对话框的真截图。

## 注意

- **碰网络、碰文件、跑脚本**：`net.connect("127.0.0.1", port)` 连 nvim；读发现文件；Apply 读改写
  `appHome()/keys.json`（就地改写，不留备份）；`probe` 写 `appHome()/splits-nav-probe.json`；
  挂载会读改写 `appHome()/layouts/*.json`（只写缺挂载的个人布局、和新建的 `<名>-nav`，带原文本做并发保护）。
  首次真实加载执行 POSIX sh（`sh link-nvim`）：必要时创建目标父目录，并在目标目录外创建/修复
  软链；除该目标软链及其父目录外不读写 mod 外文件。无 POSIX sh 时自动配置失败。
  读格子数要跑 `hc get <terminal>`（herdr-core 的 CLI）。
- 软链进 `~/.config/herdr-app/mods/` **不热重载**，改完要复制成真目录或重启 app，`status` 也不会报错。
- nvim 半和 keys.json 任缺一半都不报错，只默默退化成“移 pane”，很容易以为坏了；
  nvim 里请求 10s 超时（忙在长命令时会等），超时后才降级。
- `ctrl+h/j/k/l` 在 nvim 里本来有自己的含义，装了它就归 mod 管；`terminal` 段绑定优先于 `global`，
  别在两个段里重复绑同一键，冲突检查以 `keys()` 实际生效结果为准。
- 手编过 `shift-<单个字母或数字>` 的 splits-nav 绑定（旧版 `isChord` 接受）现在不算合法 chord：
  面板显示默认键、nvim 侧收到的也是默认键，下次 Apply 会把那条手编绑定删掉。
- 录入期间面板会通过 `shared("splits-nav.recording")` 静音 mod 的命令循环（防止被录的键
  同时触发旧 action）；面板消失不清理时（light dismiss、热重载、换布局）最多静音
  `RECORDING_TTL_MS`，之后第一条命令自愈并照常执行。
- resize 探邻居时会短暂 `pane.go` 再 `pane.focus` 还回去（几帧），按键持有会看出焦点抖；
  同侧没有邻居就不动。读尺寸依赖 `hc` 在 PATH 上（herdr-core 的 CLI），读不到就放弃这次 reshape。
- 挂载注入会重写那一份 JSON（`JSON.parse`→`stringify`），数值像 `120.0` 会变成 `120`，树本身不变；
  只对确实缺挂载的文件写一次，已经挂过的连字节都不动。Herdr 自带的布局（账本 `installed.json`
  里 `layout:<名>` 的那些）从来不写：写了会被搬到 `<名>-edited` 并每次启动重建；其中
  `COPY_FOR`（Herdr/Terminals）各做一次 `<名>-nav` 副本，其它自带布局（Herdr 98）不动
  （app 自己也可能重写副本，会保留挂载）。
- **“默认 mod 哪儿都能用”不是靠注入**：磁盘上 23 个 mod，三份自带布局只引用 8/2/1 个，
  11 个（`picker`/`help`/`confirm`/`prompt`/`toast`/`menu`/`new-menu`/`peek`/`machine-add`/
  `worktree`/`herdr-customize`）**任何布局都不引用**。它们能用是因为 **app 按名字打开**
  （键绑的是 app 命令，如 `cmd-p`→`mod.open:picker`、`cmd-/`→`app.help`），弹窗浮在当前布局上。
  而 mod 自己的键盘命令 `<mod>.<command>` 只到「当前布局里活着的那份」，所以 splits-nav 这种
  纯键盘驱动的 mod 只能每份布局挂一份。
- **注入都幂等**：布局挂载（`layoutPlan`）、`link-nvim` 软链、Apply 写 keys.json 重复跑结果一样，
  没变化就不写文件（selftest 逐条钉住，包括第二轮返回空计划）。

## 算做完的标准

- `herdr-app check mods/splits-nav` 退出码 0。
- `node mods/splits-nav/selftest.mjs` 最后一行 `all passed`（键位解析、JSON 往返、lua 转换、发现文件校验、请求/响应、布局挂载与幂等）。
- `node mods/splits-nav/selftest-install.mjs` 最后一行 `all passed`（真实 link-nvim 隔离安装、重复运行、失效软链修复、冲突保护和自动执行编排）。
- 设置键弹出对话框，九行都在；改一个键后 Apply 写入 `keys.json`。
- nvim 里按 `ctrl+h` 先切 nvim 窗口，到最左窗口再按才移 herdr pane；不开 nvim 时按键直接移 pane。
- 点某行按钮显示“按下按键…”，按下合法键后该行显示新 chord，Esc 取消后保持原 chord；
  非法键（方向/resize 行按 `cmd-shift-s`、设置行按 `escape`）在该行内显示拒绝理由且仍在录入。
- 录入期间方向键不会真的移动 pane；Apply 后新 chord 才接管。
- nvim 有 split 时按 `alt+l` 调 nvim split；只剩一个铺满窗口时按 `alt+l` 调 herdr pane；
  普通 pane 里按 `alt+l` 直接调 herdr pane。

## 写的文件

- `~/.config/herdr-app/splits-nav/nvim-<terminal>.json` —— nvim 插件的发现文件（端口/pid）。
- `~/.config/nvim/plugin/herdr-nav.lua` —— `link-nvim` 建的软链（默认 `~/.config/nvim/plugin`，`NVIM_PLUGIN_DIR` 可覆盖）。
- `~/.config/herdr-app/keys.json` —— Apply 就地改写（无备份）。
- `~/.config/herdr-app/splits-nav-probe.json` —— `splits-nav.probe` 的排障快照。
- `~/.config/herdr-app/layouts/<名>.json` —— 缺挂载的个人布局（原地补一块 floating）。
- `~/.config/herdr-app/layouts/<名>-nav.json` —— `COPY_FOR` 里那些 Herdr 自带布局的个人副本（自带文件不写），建一次。