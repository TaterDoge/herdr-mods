---Window helpers: floating-window detection, the embedded-float heuristic and
---ancestry resolution. Ported from herdr-splits.nvim's win.lua, minus the
---configurable ignore lists (this plugin has no config surface).
local M = {}

---Neovim's default floating zindex; anything explicitly below it is treated
---as embedded (a sidebar-like float that coexists with normal splits).
M.FLOATING_ZINDEX_MAX = 50

---@param winid number|nil window ID, defaults to current
---@return boolean
function M.is_floating(winid)
  return vim.api.nvim_win_get_config(winid or 0).relative ~= ''
end

---An "embedded" floating window: floating, but with a zindex below the
---default, so it visually behaves like a sidebar (e.g. snacks explorer).
---@param winid number|nil window ID, defaults to current
---@return boolean
function M.is_embedded_floating_window(winid)
  if not M.is_floating(winid) then
    return false
  end
  local cfg = vim.api.nvim_win_get_config(winid or 0)
  return cfg.zindex ~= nil and cfg.zindex < M.FLOATING_ZINDEX_MAX
end

---Resolve an embedded float to the normal window that contains its layout.
---Only window-relative ancestry is followed; malformed or unsafe chains no-op.
---@param winid number|nil window ID, defaults to current
---@return number|nil
function M.resolve_embedded_parent(winid)
  local current = winid or vim.api.nvim_get_current_win()
  if current == 0 then
    current = vim.api.nvim_get_current_win()
  end
  if not M.is_embedded_floating_window(current) then
    return nil
  end
  local tabpage = vim.api.nvim_win_get_tabpage(current)
  local visited = {}
  while true do
    if visited[current] then
      return nil
    end
    visited[current] = true
    local cfg = vim.api.nvim_win_get_config(current)
    if cfg.relative == '' then
      return current
    end
    if cfg.relative ~= 'win' or type(cfg.win) ~= 'number' or cfg.win <= 0 then
      return nil
    end
    local parent = cfg.win
    if not vim.api.nvim_win_is_valid(parent) then
      return nil
    end
    if vim.api.nvim_win_get_tabpage(parent) ~= tabpage then
      return nil
    end
    current = parent
  end
end

M.REVERSE = {
  left = 'right',
  right = 'left',
  up = 'down',
  down = 'up',
}

local function win_call(winid, callback)
  if winid == nil or winid == 0 or winid == vim.api.nvim_get_current_win() then
    return callback()
  end
  return vim.api.nvim_win_call(winid, callback)
end

---@param winid number|nil
---@param key string
---@return boolean
local function at_edge(winid, key)
  return win_call(winid, function() return vim.fn.winnr() == vim.fn.winnr(key) end)
end

function M.at_left_edge(winid)
  return at_edge(winid, 'h')
end

function M.at_right_edge(winid)
  return at_edge(winid, 'l')
end

function M.at_top_edge(winid)
  return at_edge(winid, 'k')
end

function M.at_bottom_edge(winid)
  return at_edge(winid, 'j')
end

---Where a window sits in the split layout for a horizontal/vertical axis.
---@param direction '"left"|"right"|"up"|"down"'
---@param winid number|nil
---@return '"start"'|'"middle"'|'"last"'
function M.win_position(direction, winid)
  if direction == 'left' or direction == 'right' then
    if M.at_left_edge(winid) then return 'start' end
    if M.at_right_edge(winid) then return 'last' end
    return 'middle'
  end
  if M.at_top_edge(winid) then return 'start' end
  if M.at_bottom_edge(winid) then return 'last' end
  return 'middle'
end

function M.is_full_width(winid)
  return vim.api.nvim_win_get_width(winid or 0) == vim.o.columns
end

---Accounts for cmdheight, statusline and tabline, as herdr-splits.nvim does.
function M.is_full_height(winid)
  local target = winid or 0
  local height = vim.o.lines - vim.o.cmdheight
  local tabpages = #vim.api.nvim_list_tabpages()
  local wins = 0
  local tabpage = vim.api.nvim_win_get_tabpage(target)
  for _, listed_win in ipairs(vim.api.nvim_tabpage_list_wins(tabpage)) do
    if not M.is_floating(listed_win) then
      wins = wins + 1
    end
  end
  if (vim.o.laststatus == 1 and wins > 1) or vim.o.laststatus > 1 then
    height = height - 1
  end
  if (vim.o.showtabline == 1 and tabpages > 1) or vim.o.showtabline == 2 then
    height = height - 1
  end
  return vim.api.nvim_win_get_height(target) == height
end

---Sidebar-ish buffers must never hand a resize to herdr (the reference's
---ignore list, fixed to its defaults: this plugin has no config surface).
function M.is_ignored_win(winid)
  local bufnr = vim.api.nvim_win_get_buf(winid or 0)
  local buftype = vim.api.nvim_get_option_value('buftype', { buf = bufnr })
  return vim.tbl_contains({ 'nofile', 'quickfix', 'prompt', 'help', 'terminal' }, buftype)
end

return M
