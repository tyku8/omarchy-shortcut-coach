-- Shortcut Coach tracker.
--
-- Loaded from ~/.config/hypr/hyprland.lua *before* Omarchy's defaults so it
-- sees every bind. It wraps hl.bind/hl.unbind so that:
--   * the bind table is written to catalog.tsv on every config (re)load, and
--   * each time a bound shortcut fires, one line (time, keys, description) is
--     appended to presses.tsv.
-- Only Hyprland *shortcuts* are recorded. Ordinary typing never reaches a bind
-- and is never seen. Both files live in ~/.local/state/omarchy/shortcut-coach/.
--
-- Remove the dofile line from hyprland.lua to stop tracking entirely.

-- The keybindings menu scans hyprland.lua under a stub `hl` whose members are
-- tables, not functions. Do nothing there so the menu keeps working.
if type(hl) ~= "table" or type(hl.bind) ~= "function" or type(hl.dispatch) ~= "function" then
  return
end

local home = os.getenv("HOME") or ""
local dir = home .. "/.local/state/omarchy/shortcut-coach"
local presses_path = dir .. "/presses.tsv"
local catalog_path = dir .. "/catalog.tsv"
local max_log_bytes = 2 * 1024 * 1024

os.execute("mkdir -p '" .. dir .. "'")

-- Survives config reloads, so a reload never wraps the wrapper.
_G.__shortcut_coach = _G.__shortcut_coach or {}
local state = _G.__shortcut_coach

local function original(current, wrapper, saved)
  if wrapper and current == wrapper then
    return saved
  end
  return current
end

local real_bind = original(hl.bind, state.bind_wrapper, state.real_bind)
local real_unbind = original(hl.unbind, state.unbind_wrapper, state.real_unbind)
state.real_bind, state.real_unbind = real_bind, real_unbind

local modifier_order = { SUPER = 1, CTRL = 2, ALT = 3, SHIFT = 4 }
local modifier_alias = { CONTROL = "CTRL", WIN = "SUPER", LOGO = "SUPER", MOD4 = "SUPER", META = "SUPER" }

-- "SUPER + SHIFT + r", "SHIFT SUPER + R" -> "SUPER + SHIFT + R"
local function normalize(keys)
  if type(keys) ~= "string" then
    return tostring(keys)
  end
  local mods, rest = {}, {}
  for token in keys:gmatch("[^%s%+]+") do
    local upper = token:upper()
    upper = modifier_alias[upper] or upper
    if modifier_order[upper] then
      mods[#mods + 1] = upper
    else
      rest[#rest + 1] = token:match("^[%a]$") and upper or token
    end
  end
  table.sort(mods, function(a, b)
    return modifier_order[a] < modifier_order[b]
  end)
  for _, key in ipairs(rest) do
    mods[#mods + 1] = key
  end
  return table.concat(mods, " + ")
end

local function clean(text)
  return (tostring(text or ""):gsub("[\t\r\n]", " "):sub(1, 160))
end

local function append(path, line)
  local file = io.open(path, "a")
  if file then
    file:write(line, "\n")
    file:close()
  end
end

-- Start a fresh catalog for this config load; keep the press log bounded.
local catalog = io.open(catalog_path, "w")
if catalog then
  catalog:write("#loaded\t", os.time(), "\n")
  catalog:close()
end
do
  local log = io.open(presses_path, "r")
  if log then
    local size = log:seek("end")
    log:close()
    if size and size > max_log_bytes then
      os.rename(presses_path, presses_path .. ".1")
    end
  end
end

local last_combo, last_time = nil, 0

local function record(combo, description, repeating)
  local now = os.time()
  -- A held, repeating bind (volume, resize) counts once per hold.
  if repeating and combo == last_combo and now - last_time < 2 then
    last_time = now
    return
  end
  last_combo, last_time = combo, now
  append(presses_path, now .. "\t" .. combo .. "\t" .. description)
end

local function run(dispatcher, ...)
  if type(dispatcher) == "function" then
    return dispatcher(...)
  end
  return hl.dispatch(dispatcher)
end

function state.bind_wrapper(keys, dispatcher, opts)
  local options = opts or {}
  local combo = normalize(keys)
  local description = clean(options.description)

  local kind = type(dispatcher)
  local passive = options.mouse or options.release or options.non_consuming or options.transparent
  if passive or (kind ~= "function" and kind ~= "userdata" and kind ~= "table") then
    append(catalog_path, "bind\t" .. combo .. "\t" .. description .. "\tpassive")
    return real_bind(keys, dispatcher, opts)
  end

  append(catalog_path, "bind\t" .. combo .. "\t" .. description .. "\t")

  local repeating = options.repeating == true
  local function tracked(...)
    record(combo, description, repeating)
    return run(dispatcher, ...)
  end

  -- Keep the keybindings menu's lookup tables pointing at the same command.
  local omarchy = rawget(_G, "o")
  if type(omarchy) == "table" then
    if omarchy.bind_commands and omarchy.bind_commands[dispatcher] then
      omarchy.bind_commands[tracked] = omarchy.bind_commands[dispatcher]
    end
    if omarchy.bind_expressions and omarchy.bind_expressions[dispatcher] then
      omarchy.bind_expressions[tracked] = omarchy.bind_expressions[dispatcher]
    end
  end

  return real_bind(keys, tracked, opts)
end

function state.unbind_wrapper(keys, ...)
  append(catalog_path, "unbind\t" .. normalize(keys))
  return real_unbind(keys, ...)
end

hl.bind = state.bind_wrapper
hl.unbind = state.unbind_wrapper
