---Navigation logic: answer a herdr-app splits-nav request by moving between
---Neovim splits in the current tabpage. Mode handling and edge behavior follow
---herdr-splits.nvim's nav.lua, but the herdr-side fallback is gone: edge is
---reported back to the mod, which moves the herdr pane itself.
local M = {}

local win = require('herdr-nav.win')

M.DIRECTIONS = {
  left = true,
  right = true,
  up = true,
  down = true,
}

---Map a mode's first character to how a nav request must behave.
---i/R/c: feed the key back (the plugin never consumes it in these modes).
---t: send the key to the terminal job. Anything else (normal/visual): navigate.
---@param mode string
---@return '"keys"'|'"terminal"'|'"nav"'
function M.classify_mode(mode)
  local m = tostring(mode):sub(1, 1)
  if m == 'i' or m == 'R' or m == 'c' then
    return 'keys'
  end
  if m == 't' then
    return 'terminal'
  end
  return 'nav'
end

---@param keys string
---@return string
local function termcodes(keys)
  return vim.api.nvim_replace_termcodes(keys or '', true, false, true)
end

---The window nvim itself would move to (wincmd semantics, floats excluded),
---without focusing it. Mirrors herdr-splits.nvim's move_local.
---@param ref_win number
---@param dir '"left"'|'"right"'|'"up"'|'"down"'
---@return number|nil
local function find_neighbor(ref_win, dir)
  local key = ({ left = 'h', right = 'l', up = 'k', down = 'j' })[dir]
  local want = vim.api.nvim_win_call(ref_win, function()
    local here = vim.fn.winnr()
    local there = vim.fn.winnr(key)
    if there == here then
      return nil
    end
    return vim.fn.win_getid(there)
  end)
  if want == nil or want == ref_win then
    return nil
  end
  return want
end

---Focus target; report moved once focus actually left the window we were on.
---An autocmd may redirect the move (a sidebar box such as snacks' explorer hands
---focus to its picker float), so compare with the window we came from rather than
---the exact target: the move happened either way.
---@param target number
---@return '"moved"'|'"edge"'
local function apply_move(target)
  local from = vim.api.nvim_get_current_win()
  if target == from then
    return 'moved'
  end
  local ok = pcall(vim.api.nvim_set_current_win, target)
  if ok and vim.api.nvim_get_current_win() ~= from then
    return 'moved'
  end
  return 'edge'
end

---Handle one nav request. Returns one of moved / edge / passthrough / ignore.
---@param req {op: string, dir: string, keys: string|nil}
---@return '"moved"'|'"edge"'|'"passthrough"'|'"ignore"'
function M.handle(req)
  local mode = M.classify_mode(vim.fn.mode())
  if mode == 'keys' then
    -- 'm': let nvim's own mappings decide, exactly as if the chord had arrived
    -- from the keyboard; the reference plugin never intercepts these modes.
    vim.api.nvim_feedkeys(termcodes(req.keys), 'm', false)
    return 'passthrough'
  end
  if mode == 'terminal' then
    local job = vim.b.terminal_job_id
    if job then
      pcall(vim.api.nvim_chan_send, job, termcodes(req.keys))
    end
    return 'passthrough'
  end

  -- Command-line window: window commands raise E11 there.
  if vim.fn.getcmdwintype() ~= '' then
    return 'edge'
  end

  local cur = vim.api.nvim_get_current_win()
  local cfg = vim.api.nvim_win_get_config(cur)
  local embedded = win.is_embedded_floating_window(cur)
  if cfg.relative ~= '' and not embedded then
    return 'edge'
  end

  local ref = cur
  if embedded then
    ref = win.resolve_embedded_parent(cur)
    if not ref then
      return 'edge'
    end
  end

  local target = find_neighbor(ref, req.dir)
  if not target and req.op == 'wrap' then
    target = find_neighbor(ref, win.REVERSE[req.dir])
  end
  if not target then
    return 'edge'
  end
  return apply_move(target)
end

return M
