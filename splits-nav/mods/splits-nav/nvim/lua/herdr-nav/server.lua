---TCP server for the herdr-app splits-nav mod: listens on 127.0.0.1:0,
---writes a discovery file (<appHome>/splits-nav/nvim-<HC_TERMINAL_ID>.json)
---so the mod can find the port, and answers one request per connection with
---one JSON line followed by close.
---
---Protocol (one line, JSON + LF, both ways):
---  request:  {"op":"nav"|"wrap"|"resize","dir":"left"|...,"keys":"<C-h>"}
---  response: {"action":"moved"|"edge"|"passthrough"|"ignore","t":{"rx":...,"tx":...}}
---Bad JSON, unknown op or illegal dir answer {"action":"ignore"}.
local M = {}

local uv = vim.uv or vim.loop

local nav = require('herdr-nav.nav')

---The discovery directory: HERDR_APP_HOME, else ~/.config/herdr-app.
---@return string
function M.default_dir()
  local base = vim.env.HERDR_APP_HOME
  if not base or base == '' then
    base = (os.getenv('HOME') or '~') .. '/.config/herdr-app'
  end
  return base .. '/splits-nav'
end

local function respond(client, action, rx)
  local payload = vim.json.encode({
    action = action,
    t = { rx = rx, tx = uv.hrtime() },
  })
  client:write(payload .. '\n', function(err)
    client:close()
  end)
end

---@param state {buf: string}
local function on_client_data(client, data, state)
  state.buf = state.buf .. data
  local nl = state.buf:find('\n')
  if not nl then
    return
  end
  local line = state.buf:sub(1, nl - 1)
  local rx = uv.hrtime()
  -- uv callbacks run in a fast event context where most vimscript functions
  -- (mode, nvim_win_get_config, ...) are forbidden (E5560); defer the whole
  -- handling to the main loop via vim.schedule before touching the API.
  vim.schedule(function()
    local ok, req = pcall(vim.json.decode, line)
    if not ok or type(req) ~= 'table' then
      respond(client, 'ignore', rx)
      return
    end
    local op, dir = req.op, req.dir
    if (op ~= 'nav' and op ~= 'wrap' and op ~= 'resize')
        or type(dir) ~= 'string'
        or not nav.DIRECTIONS[dir] then
      respond(client, 'ignore', rx)
      return
    end
    -- The sender names the instance it means to reach. A stale discovery file
    -- whose port is now bound by another nvim must not be driven, and answering
    -- plainly would look like success, so refuse with a verdict the sender can
    -- tell apart from a handled request.
    if req.terminal ~= vim.env.HC_TERMINAL_ID or req.pid ~= vim.fn.getpid() then
      respond(client, 'stale', rx)
      return
    end
    local action = nav.handle({ op = op, dir = dir, keys = req.keys })
    respond(client, action, rx)
  end)
end

local function on_connection(client)
  local state = { buf = '' }
  client:read_start(function(err, data)
    if err or not data then
      client:close()
      return
    end
    on_client_data(client, data, state)
  end)
end

---Bind, listen and write the discovery file atomically. Returns true on
---success; the state is kept in M for stop() to tear down.
---@param opts {terminal_id: string, dir: string}
---@return boolean
function M.start(opts)
  vim.fn.mkdir(opts.dir, 'p')
  local server = uv.new_tcp()
  server:bind('127.0.0.1', 0)
  local listen_ok = server:listen(16, function(err)
    if err then
      return
    end
    local client = uv.new_tcp()
    if server:accept(client) == 0 then
      on_connection(client)
    else
      client:close()
    end
  end)
  if not listen_ok then
    server:close()
    return false
  end
  local addr = server:getsockname()
  local pid = vim.fn.getpid()
  local path = opts.dir .. '/nvim-' .. opts.terminal_id .. '.json'
  -- A nested nvim shares HC_TERMINAL_ID and would otherwise delete the parent's
  -- entry on exit, leaving a live server unreachable. Keep what we replace.
  M._prev = nil
  local prev = io.open(path, 'r')
  if prev then
    local text = prev:read('*a')
    prev:close()
    local ok, d = pcall(vim.json.decode, text)
    if ok and type(d) == 'table' and d.pid ~= pid and type(d.port) == 'number' then
      M._prev = text
    end
  end
  local payload = vim.json.encode({
    schema = 1,
    terminal = opts.terminal_id,
    port = addr.port,
    pid = pid,
  })
  local tmp = path .. '.tmp.' .. pid .. '.' .. tostring(uv.hrtime())
  local f = io.open(tmp, 'w')
  if not f then
    server:close()
    return false
  end
  f:write(payload)
  f:close()
  os.rename(tmp, path)
  M._server = server
  M._path = path
  M._pid = pid
  return true
end

---Close the server and delete the discovery file when it is ours (pid match).
function M.stop()
  if M._server then
    pcall(M._server.close, M._server)
    M._server = nil
  end
  if M._path then
    local f = io.open(M._path, 'r')
    if f then
      local content = f:read('*a')
      f:close()
      local ok, d = pcall(vim.json.decode, content)
      if ok and type(d) == 'table' and d.pid == M._pid then
        if M._prev then
          -- Put the parent instance's entry back instead of deleting it.
          local tmp = M._path .. '.tmp.' .. M._pid .. '.' .. tostring(uv.hrtime())
          local back = io.open(tmp, 'w')
          if back then
            back:write(M._prev)
            back:close()
            os.rename(tmp, M._path)
          end
        else
          pcall(os.remove, M._path)
        end
      end
    end
    M._path = nil
  end
end

return M
