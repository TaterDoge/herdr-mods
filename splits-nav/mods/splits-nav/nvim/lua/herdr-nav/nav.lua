---Navigation and resize logic: answer a herdr-app splits-nav request by
---moving between Neovim splits in the current tabpage, or resizing them.
---Mode handling and edge behavior follow herdr-splits.nvim's nav.lua and
---resize.lua, but the herdr-side fallback is gone: edge is reported back to
---the mod, which resizes or moves the herdr pane itself.
local M = {}

local win = require('herdr-nav.win')

---Resize amounts, as herdr-splits.nvim defaults them.
M.NEOVIM_CELLS = 3
M.HERDR_RATIO = 0.03

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

---Handle one request (nav, wrap or resize). Returns one of
---moved / edge / passthrough / ignore.
---@param req {op: string, dir: string, keys: string|nil}
---@return '"moved"'|'"edge"'|'"passthrough"'|'"ignore"'
function M.handle(req)
  if req.op == 'resize' then
    return M.handle_resize(req)
  end
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

---Compute the +/- operator for a vertical resize.
---At start/middle: resize_up shrinks (-), resize_down grows (+).
---At last (bottom): inverted — resize_up grows (+), resize_down shrinks (-).
---@param direction '"up"|"down"'
---@param winid number
---@return '"+"|"-"'
local function compute_vertical(direction, winid)
  local pos = win.win_position(direction, winid)
  if pos == 'start' or pos == 'middle' then
    return direction == 'down' and '+' or '-'
  end
  return direction == 'down' and '-' or '+'
end

---Compute the +/- operator for a horizontal resize.
---At start/middle: resize_left shrinks (-), resize_right grows (+).
---At last (right): inverted — resize_left grows (+), resize_right shrinks (-).
---@param direction '"left"|"right"'
---@param winid number
---@return '"+"|"-"'
local function compute_horizontal(direction, winid)
  local pos = win.win_position(direction, winid)
  if pos == 'start' or pos == 'middle' then
    return direction == 'right' and '+' or '-'
  end
  return direction == 'right' and '-' or '+'
end

---Handle one resize request. Native when the window has a Neovim split
---neighbour in that dimension; when it spans the whole terminal (both edges),
---report 'edge' so the mod resizes the herdr pane instead.
---@param req {dir: string}
---@return '"moved"|"edge"|"ignore"'
function M.handle_resize(req)
  if vim.fn.getcmdwintype() ~= '' then
    return 'edge'
  end

  local current_win = vim.api.nvim_get_current_win()
  local embedded = win.is_embedded_floating_window(current_win)
  local geometry_win = current_win
  if embedded then
    geometry_win = win.resolve_embedded_parent(current_win)
    if not geometry_win then
      return 'ignore'
    end
  end

  -- A plain float is its own thing: no herdr resize behind its back.
  if win.is_floating(current_win) and not embedded then
    return 'ignore'
  end

  local is_horiz = req.dir == 'left' or req.dir == 'right'
  local delegate = is_horiz
      and win.is_full_width(geometry_win)
      and win.at_left_edge(geometry_win)
      and win.at_right_edge(geometry_win)
    or not is_horiz
      and win.is_full_height(geometry_win)
      and win.at_top_edge(geometry_win)
      and win.at_bottom_edge(geometry_win)
  -- A sidebar (quickfix etc.) must not hand the resize to herdr; the
  -- command-line window is exempted, as in the reference.
  if delegate and win.is_ignored_win(geometry_win) and not win.is_command_line_window() then
    delegate = false
  end
  if delegate then
    return 'edge'
  end

  local op = is_horiz
      and compute_horizontal(req.dir, geometry_win)
    or compute_vertical(req.dir, geometry_win)
  local command = is_horiz
      and ('vertical resize ' .. op .. M.NEOVIM_CELLS)
    or ('resize ' .. op .. M.NEOVIM_CELLS)
  if geometry_win == current_win then
    pcall(vim.cmd, command)
  else
    pcall(vim.api.nvim_win_call, geometry_win, function()
      vim.cmd(command)
    end)
  end
  return 'moved'
end

return M
