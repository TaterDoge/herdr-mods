local here = vim.fs.dirname(debug.getinfo(1, "S").source:sub(2))
vim.opt.runtimepath:append(vim.fs.joinpath(here, "mods/nvim-palette/nvim"))
vim.opt.runtimepath:append(assert(arg[1], "pass the ColorRex checkout path"))

local home = vim.fn.tempname()
vim.fn.mkdir(home)
vim.env.HERDR_APP_HOME = home
local path = vim.fs.joinpath(home, "nvim-palette.json")

local ok, err = xpcall(function()
  local bridge = require("herdr-palette")
  vim.cmd.colorscheme("habamax")
  vim.env.HC_TERMINAL_ID = "test"
  assert(not bridge.available())

  local function export(fg, bg, red)
    local ansi = {}
    for i = 1, 16 do
      ansi[i] = string.format("#%02x4080", i * 12)
    end
    ansi[2] = red
    local next_palette = vim.json.encode({ fg = fg, bg = bg, ansi = ansi })
    assert(vim.fn.writefile({ next_palette }, path .. ".next") == 0)
    assert(vim.uv.fs_rename(path .. ".next", path))
  end

  export("#202124", "#f0f0f0", "#b4637a")
  vim.env.HC_TERMINAL_ID = nil
  bridge.setup()
  assert(vim.g.colors_name == "habamax")

  vim.env.HC_TERMINAL_ID = "test"
  bridge.setup()
  assert(vim.g.colors_name == "herdr-palette" and vim.o.background == "light")
  assert(vim.g.terminal_color_1 == "#b4637a")

  export("#dddddd", "#202124", "#eb6f92")
  local reloaded = vim.wait(2000, function()
    return vim.g.terminal_color_1 == "#eb6f92"
  end)
  assert(reloaded, "palette reload did not arrive")
  assert(vim.g.colors_name == "herdr-palette" and vim.o.background == "dark")
end, debug.traceback)

vim.fn.delete(home, "rf")
assert(ok, err)
print("nvim-palette selftest passed")
