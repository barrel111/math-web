local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local extract = dofile(directory .. "extract.lua")
local M = {}

-- Read control words and symbols without expanding TeX. Escaped percent signs
-- and backslashes are consumed as tokens before comment handling.
function M.commands(text)
  local names = {}
  local position = 1
  while position <= #text do
    local character = text:sub(position, position)
    if character == "\\" then
      local name, next_position = extract.extract_cmd_name(text, position)
      if name then
        names[name] = true
        position = next_position
      else
        position = position + 2 -- control-space or a trailing backslash
      end
    elseif character == "%" then
      while position <= #text and not text:sub(position, position):match("[\r\n]") do
        position = position + 1
      end
    else
      position = position + 1
    end
  end
  return names
end

-- Only reachable definitions are scanned; the queue handles cycles without recursion.
-- A computed command name cannot be resolved this way: conservatively retain
-- the entire map and return a reason, rather than silently dropping dependencies.
function M.select(definitions, expressions, included_names)
  local retained = {}
  local pending_names = {}

  local function retain_command(name)
    if definitions[name] and not retained[name] then
      retained[name] = definitions[name]
      pending_names[#pending_names + 1] = name
    end
  end

  local function retain_literal_references(text)
    local commands = M.commands(text)
    if commands.csname then return false end
    for name in pairs(commands) do retain_command(name) end
    return true
  end

  local function retain_all_for_computed_names()
    return definitions, nil, "computed command names (\\csname) require retaining all imported macros"
  end

  for _, name in ipairs(included_names or {}) do
    local command_name = name:gsub("^\\", "")
    if not definitions[command_name] then
      return nil, "'math-web.include' names an undefined imported command: \\" .. command_name
    end
    retain_command(command_name)
  end
  for _, expression in ipairs(expressions) do
    if not retain_literal_references(expression) then return retain_all_for_computed_names() end
  end

  local index = 1
  while index <= #pending_names do
    local definition = definitions[pending_names[index]]
    if definition.kind == "paired" then
      if not retain_literal_references(definition.opening)
        or not retain_literal_references(definition.closing) then
        return retain_all_for_computed_names()
      end
    end
    local body_is_literal = retain_literal_references(definition.body)
    local default_is_literal = retain_literal_references(definition.default or "")
    if not body_is_literal or not default_is_literal then
      return retain_all_for_computed_names()
    end
    if definition.kind == "operator" then retain_command("operatorname") end
    index = index + 1
  end
  return retained
end

return M
