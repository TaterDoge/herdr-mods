-- Entry point for installing the whole repo with a plugin manager
-- (`{ "TaterDoge/herdr-mods", lazy = false }`): a plugin manager puts the repo
-- root on runtimepath and sources only its own plugin/, so hand off to the
-- mod's nvim half. That file finds its own folder, appends it to runtimepath
-- and does nothing outside a herdr-app terminal.
dofile(vim.fn.fnamemodify(debug.getinfo(1, 'S').source:sub(2), ':p:h:h')
  .. '/mods/splits-nav/nvim/plugin/herdr-nav.lua')
