local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local extract = dofile(directory .. "extract.lua")
local M = {}

function M.apply(definitions, mappings)
  local result = {}
  for name, definition in pairs(definitions) do result[name] = definition end
  for name, target in pairs(mappings or {}) do
    if type(name) ~= "string" or type(target) ~= "string" then
      return nil, "mappings must associate command names with command names"
    end
    name, target = name:gsub("^\\", ""), target:gsub("^\\", "")
    local function valid(command)
      local parsed, after = extract.extract_cmd_name("\\" .. command, 1)
      return parsed == command and after == #command + 2
    end
    if not valid(name) or not valid(target) or name == target then
      return nil, "invalid command mapping: " .. name .. " -> " .. target
    end
    if definitions[name] then return nil, "mapping would replace imported command \\" .. name end
    result[name] = {name = name, body = "\\" .. target, nargs = 0, kind = "command",
      source = "math-web.mappings", line = 1, column = 1, mapped = true}
  end
  return result
end

return M
