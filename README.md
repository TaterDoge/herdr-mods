# herdr-mods

我的 herdr app mods。一个 repo 塞好几个，GitHub topic 打 `herdr-mod`。

mod 就是纯 JavaScript，只依赖 `gpui-kit` 和 herdr 自己那几个模块，没有 HTML/CSS，
也没有 web view，更不需要构建。每个 mod 是一个自包含的文件夹，`herdr-app check`
过了我就当它能用。

## 结构

```text
splits-nav/         一个上架单元（herdr.dev/mods 上的一条）
  RECIPE.md         必须：别人从空文件夹重建它的说明
  preview.png       必须：上架用的图（真截图或宣传图，不能是占位）
  keys.json         可选：安装模板，合并进用户自己的 keys.json
  mods/<name>/      必须：mod 本体
    main.js         必须：默认导出 extends View 的类
    mod.json        必须：{ "place": "none" | "left" | "right" | "top" | "bottom", "title"?, "overlay"? }
    *.js *.svg      可选：同文件夹的模块与图标
    fonts/          可选：自带的字体
    screenshot.png  可选：mod 跑在真 app 里的实际截图
    nvim/ link-nvim 可选：这个 mod 自己的 nvim 半（插件源码 + 安装脚本，首次真实加载时自动跑）
scripts/link        把所有 mod 软链进 ~/.config/herdr-app/mods（首次装载可用，改完的热重载失效，见下）
```

mod 里能 import 的只有 `gpui-kit`、`gpui-base`、`herdr`，以及同文件夹的 `./x.js`。
跨 mod 共用代码我没做，因为软链之后相对路径会错。真想抽，等第三次出现再说。

## 开发循环

```sh
scripts/link                          # 一次性：*/mods/* -> ~/.config/herdr-app/mods/*
herdr-app check splits-nav/mods/splits-nav   # 每次改完都跑，退出码 0 才算完
herdr-app status                      # 看有没有报错
herdr-app shot /tmp/x.png             # 截图看实际渲染
```

有个坑记一下：热重载只对 `~/.config/herdr-app/mods/` 里的**真文件夹**生效。软链进去的
mod 改完不会被重新加载，`herdr-app status` 也不会报错，就是旧代码一直在跑。2026-10-31
实测过同一份代码，软链时不生效、换成真目录后立刻就生效了。所以改逻辑要么重启 app，
要么把文件夹复制成真目录再看。

文档看 `~/.config/herdr-app/AGENTS.md`，它是唯一权威的那份（每次启动都会被重写，
别去编辑），`herdr.d.ts` 和 `gpui-kit.d.ts` 是真实类型。app 会往它加载的 mod 文件夹里
写 `jsconfig.json`，所以 Cha 里直接有补全。

放进窗口：

```sh
herdr-app do pane.split:right --mod splits-nav
```

也可以复制 `layouts/main.json` 到 `my-layout`，把某个 block 的 `content.mod` 改成自己的。

## 发布

前提是 `herdr-app check` 过了、`preview.png` 是上架用的图、`RECIPE.md` 按模板写完。
推之前记得几件事：

一个上架单元是仓库里的一个文件夹：`<unit>/RECIPE.md`、`<unit>/preview.png`、
`<unit>/keys.json`（可选）、`<unit>/mods/<name>/`。`RECIPE.md` 和 `preview.png` 必须与
`mods/` **同一层**，仓库根不放（放根上就是「整包一条」，不是每 mod 一条）。形状不对
爬虫整仓库跳过，一条都不出：索引 https://assets.herdr.dev/mods/index.json 里搜不到
你的仓库就是被跳过了。一个 repo 放好几个单元、每个单元各自一条是官方支持的
（herdr.dev/mods 页原话）。

nvim 半件只走 `mods/<name>/link-nvim`，脚本把半件软链进 `~/.config/nvim/plugin`
（`NVIM_PLUGIN_DIR` 可覆盖），软链自己解析回 mod 目录并加进 runtimepath。别指望包管理器：
repo 根没有 `plugin/`，lazy.nvim 这类把它当插件装进来不会加载任何东西，也没人该这么装。

装的时候 mod 侧和 nvim 侧都是用户自己的 agent 读 `RECIPE.md` 配完（复制 mod、合并
`keys.json`、布局挂 floating 块；nvim 半件在首次真实加载时自动配置，见 `RECIPE.md`），
用户不用写配置。

推到公开 repo、给仓库加 topic `herdr-mod`，一小时内会出现在 herdr.dev/mods。

## 已有 mod

`splits-nav` 一个 mod 两副面孔。托盘里挂个 0×0 的空块收 `ctrl+h/j/k/l`，在 pane 之间
移动；焦点在 nvim 时就往 nvim 插件（`splits-nav/mods/splits-nav/nvim`，走 TCP 加一个发现文件）发
导航请求，nvim 先切自己的窗口，到边缘才回退给 herdr 移 pane。按设置键（默认
`ctrl-shift-h`）会打开设置对话框，可以改键、做冲突检查，Apply 写 `keys.json` 并带时间戳
备份；`splits-nav.probe` 写排障快照。

要装它得配一个克隆布局里的 floating 块、`keys.json` 那五个键（模板在 `splits-nav/keys.json`）、
还有 nvim 侧（首次真实加载时自动跑 `splits-nav/mods/splits-nav/link-nvim`，复制文件本身
不执行任何代码）。细节在它的 `RECIPE.md`。
