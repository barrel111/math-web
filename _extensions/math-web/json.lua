local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local quote = dofile(directory .. "javascript.lua").quote
local M = {}
function M.encode(value)
  local kind = type(value)
  if kind == "string" then return quote(value) end
  if kind == "number" or kind == "boolean" then return tostring(value) end
  if value == nil then return "null" end
  assert(kind == "table", "unsupported JSON value")
  local keys, array = {}, true
  for key in pairs(value) do
    keys[#keys + 1] = key
    if type(key) ~= "number" then array = false end
  end
  local entries = {}
  if array then
    for _, item in ipairs(value) do entries[#entries + 1] = M.encode(item) end
    return "[" .. table.concat(entries, ",") .. "]"
  end
  table.sort(keys)
  for _, key in ipairs(keys) do entries[#entries + 1] = quote(key) .. ":" .. M.encode(value[key]) end
  return "{" .. table.concat(entries, ",") .. "}"
end
return M
