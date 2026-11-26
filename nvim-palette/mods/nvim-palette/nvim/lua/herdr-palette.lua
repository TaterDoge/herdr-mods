local M = {}
local name = "herdr-palette"
local filename = "nvim-palette.json"
local app_home = vim.env.HERDR_APP_HOME or vim.fn.expand("~/.config/herdr-app")
local path = vim.fs.joinpath(app_home, filename)
local watcher

local function hex(color)
  if type(color) == "string" and color:match("^#%x%x%x%x%x%x$") then
    return color
  end
end

local function read_palette()
  local ok, lines = pcall(vim.fn.readfile, path, "", 1)
  if not ok then
    return
  end
  local decoded, palette = pcall(vim.json.decode, lines[1] or "")
  if not decoded or type(palette) ~= "table" or type(palette.ansi) ~= "table" then
    return
  end
  local colors = { fg = hex(palette.fg), bg = hex(palette.bg), cursor = hex(palette.cursor), ansi = {} }
  if not colors.fg or not colors.bg then
    return
  end
  for i = 0, 15 do
    colors.ansi[i] = hex(palette.ansi[i + 1])
    if not colors.ansi[i] then
      return
    end
  end
  return colors
end

function M.available()
  return vim.env.HC_TERMINAL_ID ~= nil and vim.fn.filereadable(path) == 1
end

function M.setup()
  if M.available() then
    vim.cmd.colorscheme(name)
  end
end

function M.load()
  local palette = read_palette()
  if not palette then
    return
  end

  -- shortcut: uses the pinned ColorRex compiler until it exposes a palette input API.
  local options = require("colorrex.config").resolve()
  local scheme = require("colorrex.compiler").compile(palette, options, vim.o.background)
  vim.cmd.highlight("clear")
  vim.o.background = scheme.background
  vim.o.termguicolors = true
  vim.g.colors_name = name
  for group, spec in pairs(scheme.groups) do
    vim.api.nvim_set_hl(0, group, spec)
  end
  for i = 0, 15 do
    vim.g["terminal_color_" .. i] = scheme.filled.ansi[i]
  end

  if not watcher then
    local handle = assert(vim.uv.new_fs_event())
    -- An atomic replacement changes the file itself, so watch its directory.
    local started, err = handle:start(
      app_home,
      {},
      vim.schedule_wrap(function(event_error, changed)
        if not event_error and changed == filename and vim.g.colors_name == name then
          vim.cmd.colorscheme(name)
        end
      end)
    )
    if started then
      watcher = handle
    else
      handle:close()
      vim.notify("Herdr Palette could not watch " .. path .. ": " .. err, vim.log.levels.WARN)
    end
  end
end

return M
