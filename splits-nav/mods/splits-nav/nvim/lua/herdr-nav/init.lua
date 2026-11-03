---herdr-nav entry point. start() boots the TCP server and discovery file when
---running inside a herdr-app terminal (HC_TERMINAL_ID set); stop() tears both
---down; _selfcheck() is the headless assertion suite.
local M = {}

local server = require('herdr-nav.server')
local nav = require('herdr-nav.nav')

local function enabled_terminal()
  local id = vim.env.HC_TERMINAL_ID
  if id and id ~= '' then
    return id
  end
  return nil
end

---Start the plugin. Idempotent (vim.g.loaded_herdr_nav guards). Outside a
---herdr-app terminal there is nothing to talk to and nothing to do.
---@param opts {dir?: string, terminal_id?: string}|nil
---@return boolean
function M.start(opts)
  if vim.g.loaded_herdr_nav then
    return true
  end
  local terminal_id = opts and opts.terminal_id or enabled_terminal()
  if not terminal_id then
    return false
  end
  local dir = (opts and opts.dir) or server.default_dir()
  local ok = server.start({ terminal_id = terminal_id, dir = dir })
  if not ok then
    return false
  end
  vim.g.loaded_herdr_nav = true
  if not (opts and opts.dir) then
    -- Production path: clean up on exit. Self-check manages its own tmp dir.
    vim.api.nvim_create_autocmd('VimLeavePre', {
      group = vim.api.nvim_create_augroup('herdr-nav', { clear = true }),
      callback = function()
        M.stop()
      end,
      once = true,
    })
  end
  return true
end

function M.stop()
  server.stop()
  vim.g.loaded_herdr_nav = nil
end

---Headless self-check: mode matrix, double-split moved/edge, discovery write
---and delete. Run with:
---  nvim --headless -u NONE -c "lua assert(require('herdr-nav')._selfcheck())" -c qa
---@return boolean
function M._selfcheck()
  local mode_cases = {
    { 'n', 'nav' }, { 'v', 'nav' }, { 'V', 'nav' }, { '\22', 'nav' },
    { 'i', 'keys' }, { 'R', 'keys' }, { 'c', 'keys' }, { 't', 'terminal' },
  }
  for _, c in ipairs(mode_cases) do
    local got = nav.classify_mode(c[1])
    assert(got == c[2], ('classify_mode(%q) = %q, want %q'):format(c[1], got, c[2]))
  end

  vim.cmd('enew | vsplit')
  local wins = vim.api.nvim_list_wins()
  assert(#wins >= 2, 'need two windows for the split test')
  local left, right = wins[1], wins[2]
  vim.api.nvim_set_current_win(left)
  assert(nav.handle({ op = 'nav', dir = 'left', keys = '<C-h>' }) == 'edge',
    'left window, nav left -> edge')
  assert(nav.handle({ op = 'nav', dir = 'right', keys = '<C-l>' }) == 'moved',
    'left window, nav right -> moved')
  assert(vim.api.nvim_get_current_win() == right, 'current window changed to right')
  assert(nav.handle({ op = 'nav', dir = 'right', keys = '<C-l>' }) == 'edge',
    'right window, nav right -> edge')
  assert(nav.handle({ op = 'wrap', dir = 'right', keys = '<C-l>' }) == 'moved',
    'right window, wrap right -> moved (back to left)')
  assert(vim.api.nvim_get_current_win() == left, 'wrap returned to left')

  -- Resize: a split resizes natively (width changes, no handoff), and a
  -- window that fills the whole terminal reports edge so the mod resizes
  -- the herdr pane instead.
  vim.api.nvim_set_current_win(left)
  local before = vim.api.nvim_win_get_width(left)
  assert(nav.handle({ op = 'resize', dir = 'right', keys = '<A-l>' }) == 'moved',
    'resize right with a split -> moved')
  assert(vim.api.nvim_win_get_width(left) ~= before, 'resize changed the split width')
  vim.api.nvim_set_current_win(right)
  assert(nav.handle({ op = 'resize', dir = 'left', keys = '<A-h>' }) == 'moved',
    'resize left from the right window -> moved')

  -- A sidebar (snacks' explorer layout box) may hand focus on to its own picker
  -- float the moment it is entered; the move still happened and must not be
  -- reported as an edge the caller would answer with a herdr pane move.
  vim.api.nvim_set_current_win(left)
  local redirect = vim.api.nvim_create_autocmd('WinEnter', {
    once = true,
    callback = function()
      vim.api.nvim_set_current_win(right)
    end,
  })
  local redirected = nav.handle({ op = 'nav', dir = 'right', keys = '<C-l>' })
  pcall(vim.api.nvim_del_autocmd, redirect)
  assert(redirected == 'moved', 'a redirected move still reports moved')
  assert(vim.api.nvim_get_current_win() == right, 'focus ended on the redirected window')

  -- A lone full-width window must hand the resize to herdr (edge).
  vim.cmd('only')
  assert(nav.handle({ op = 'resize', dir = 'right', keys = '<A-l>' }) == 'edge',
    'resize right with a single full-width window -> edge')

  local tmp = os.getenv('TMPDIR') or '/tmp'
  local dir = tmp .. '/herdr-nav-selfcheck-' .. vim.fn.getpid()
  assert(server.start({ dir = dir, terminal_id = 'tzself' }), 'server start')
  local path = dir .. '/nvim-tzself.json'
  local f = assert(io.open(path, 'r'), 'discovery file written')
  local content = f:read('*a')
  f:close()
  local d = vim.json.decode(content)
  assert(d.schema == 1 and d.terminal == 'tzself' and type(d.port) == 'number'
    and d.pid == vim.fn.getpid(), 'discovery payload shape')
  server.stop()
  local g = io.open(path, 'r')
  assert(g == nil, 'discovery file deleted after stop')
  if g then
    g:close()
  end
  return true
end

return M
