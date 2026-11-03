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

return M
