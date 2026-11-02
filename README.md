# herdr-mods

我的 herdr app mods，一个 repo 放多个，GitHub topic `herdr-mod`。

Mod 是纯 JavaScript（gpui-kit + herdr 模块），没有 HTML/CSS/web view，不经过构建。
每个 mod 是一个自包含文件夹，`herdr-app check` 通过即视为可交付。

## 结构

```text
mods/<name>/        一个 mod
  main.js           必须：默认导出 extends View 的类
  mod.json          必须：{ "place": "none" | "left" | "right" | "top" | "bottom", "title"?, "overlay"? }
  *.js *.svg        可选：同文件夹的模块与图标
  fonts/            可选：自带的字体
  RECIPE.md         必须：别人从空文件夹重建它的说明
  preview.png       必须：上架用的图（真截图或宣传图，不能是占位）
  screenshot.png    可选：mod 跑在真 app 里的实际截图
  nvim/ link-nvim   可选：这个 mod 自己的 nvim 半（插件源码 + 不跑包管理器时的安装脚本）
plugin/             可选（repo 根）：薄壳，把仓库当归自己的插件装时转交给 mod 的 nvim/
keys.json           可选（repo 根）：安装模板，合并进用户自己的 keys.json
scripts/link        把所有 mod 软链进 ~/.config/herdr-app/mods（首次装载可用，改完的热重载失效，见下）
```

mod 只能导入 `gpui-kit`、`gpui-base`、`herdr` 和同文件夹的 `./x.js`。
跨 mod 共享代码不要做：软链后相对路径会错，DRY 到第三次出现再考虑。

## 开发循环

```sh
scripts/link                          # 一次性：mods/* -> ~/.config/herdr-app/mods/*
herdr-app check mods/splits-nav       # 每次改完都跑，退出码 0 才算完
herdr-app status                      # 看有没有报错
herdr-app shot /tmp/x.png             # 截图看实际渲染
```

热重载只对 `~/.config/herdr-app/mods/` 里的**真文件夹**生效：软链进去的 mod 改完
不会被重新加载，`herdr-app status` 也不报错，只是旧代码继续跑（2026-10-31 实测：
同一份代码软链时不生效、换成真目录后立即生效）。改逻辑后要么重启 app，要么把
文件夹复制成真目录再看。

`~/.config/herdr-app/AGENTS.md` 是唯一权威文档（每次启动重写，别编辑），
`herdr.d.ts`、`gpui-kit.d.ts` 是真实类型；app 会往被它加载的 mod 文件夹里写
`jsconfig.json`，Cha 里直接有提示。

放进窗口：

```sh
herdr-app do pane.split:right --mod splits-nav
```

或者复制 `layouts/main.json` 到 `my-layout`，把某个 block 的 `content.mod` 改成自己的。

## 发布

`herdr-app check` 通过、`preview.png` 是上架用的图、`RECIPE.md` 六节齐全，推之前弄清两件事：

1. **仓库根要能被当成 mod 仓库读**：`keys.json`、各 `mods/<name>/`、`RECIPE.md`、
   `preview.png`。一个 repo 可以放好几个 mod（herdr.dev/mods 页原话）。
2. **nvim 半件的入口**：包管理器只把 repo 根放进 runtimepath、只 source 它自己的
   `plugin/`，所以 repo 根的 `plugin/herdr-nav.lua` 负责转交给 `mods/splits-nav/nvim/`。
   别删它，否则 `{ "<owner>/herdr-mods" }` 装完什么都不加载（实测：只加仓库根，
   `g:loaded_herdr_nav` 仍是 nil）。

按上面两条推完，用户两侧各一步，都不跑脚本：

```lua
-- nvim 侧（lazy.nvim）
{ "TaterDoge/herdr-mods", lazy = false }
```

mod 侧：让用户自己的 agent 读 `RECIPE.md`，或把 `mods/splits-nav/` 复制进
`~/.config/herdr-app/mods/`、合并 `keys.json`、布局里挂 floating 块。

推到公开 repo 并给仓库加 topic `herdr-mod`，一小时内出现在 herdr.dev/mods。

## 已有 mod

- `splits-nav` —— 一个 mod 两副面孔：托盘里的 0×0 空块收 `ctrl+h/j/k/l`，在 pane 之间
  移动；焦点在 nvim 时向 nvim 插件（`mods/splits-nav/nvim`，TCP + 发现文件）发导航请求，
  nvim 内优先切自己的窗口，到边缘才回退给 herdr 移 pane。按设置键（默认
  `ctrl-shift-h`）打开设置对话框：改键、冲突检查、Apply 写 `keys.json`（带时间戳备份）；
  `splits-nav.probe` 写排障快照。要配一个克隆布局里的 floating 块、`keys.json` 的五个键
  （模板见 repo 根 `keys.json`）和 nvim 侧（lazy.nvim 一行 `{ "TaterDoge/herdr-mods", lazy = false }`，
  或用 `mods/splits-nav/link-nvim` 装），见它的 `RECIPE.md`。