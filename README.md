# herdr-mods

我的 herdr app mods，一个 repo 放多个，GitHub topic `herdr-mod`。

Mod 是纯 JavaScript（gpui-kit + herdr 模块），没有 HTML/CSS/web view，不经过构建。
每个 mod 是一个自包含文件夹，`herdr-app check` 通过即视为可交付。

## 结构

```text
mods/<name>/        一个 mod
  main.js           必须：默认导出 extends View 的类
  mod.json          必须：{ "place": "none" | "left" | "right" | "top" | "bottom", "title"? }
  *.js *.svg        可选：同文件夹的模块与图标
  fonts/            可选：自带的字体
  RECIPE.md         必须：别人从空文件夹重建它的说明
  preview.png       必须：真截图，不是占位
scripts/link        把所有 mod 软链进 ~/.config/herdr-app/mods，边改边看
```

mod 只能导入 `gpui-kit`、`gpui-base`、`herdr` 和同文件夹的 `./x.js`。
跨 mod 共享代码不要做：软链后相对路径会错，DRY 到第三次出现再考虑。

## 开发循环

```sh
scripts/link                          # 一次性：mods/* -> ~/.config/herdr-app/mods/*
herdr-app check mods/branches         # 每次改完都跑，退出码 0 才算完
herdr-app status                      # 看有没有报错
herdr-app shot /tmp/x.png             # 截图看实际渲染
```

`~/.config/herdr-app/AGENTS.md` 是唯一权威文档（每次启动重写，别编辑），
`herdr.d.ts`、`gpui-kit.d.ts` 是真实类型；app 会往被它加载的 mod 文件夹里写
`jsconfig.json`，Cha 里直接有提示。

放进窗口：

```sh
herdr-app do pane.split:right --mod branches
```

或者复制 `layouts/main.json` 到 `my-layout`，把某个 block 的 `content.mod` 改成自己的。

## 发布

`herdr-app check` 通过、`preview.png` 是真截图、`RECIPE.md` 六节齐全，
推到公开 repo 并加 topic `herdr-mod`，一小时内出现在 herdr.dev/mods。

## 已有 mod

- `branches` —— 每个 space 一行，显示当前 git 分支，点击切换。
- `splits-nav` —— `ctrl+h/j/k/l` 在 pane 间移动，焦点在 nvim 时把键转发进 nvim。
  要配一个克隆布局里的 floating 托管块和 `keys.json` 的四个键，见它的 `RECIPE.md`。