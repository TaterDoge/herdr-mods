-- herdr-nav: the nvim half of the splits-nav mod, living in
-- mods/splits-nav/nvim so the whole mod is one folder. Installed either with
-- that folder on runtimepath (lazy/pack/vim.pack) or by symlinking this single
-- file into ~/.config/nvim/plugin: it finds its own directory (through the
-- symlink) and puts it on runtimepath before requiring the plugin.
-- Outside a herdr-app terminal (no HC_TERMINAL_ID) this file is a no-op.
if vim.g.loaded_herdr_nav then
  return
end
local terminal_id = vim.env.HC_TERMINAL_ID
if not terminal_id or terminal_id == '' then
  return
end
local this = vim.fn.resolve(vim.fn.fnamemodify(debug.getinfo(1, 'S').source:sub(2), ':p'))
local dir = vim.fn.fnamemodify(this, ':h:h')
local rtp = vim.opt.runtimepath:get()
if not (vim.tbl_contains(rtp, dir) or vim.tbl_contains(rtp, vim.fn.resolve(dir))) then
  vim.opt.runtimepath:append(dir)
end
require('herdr-nav').start()
