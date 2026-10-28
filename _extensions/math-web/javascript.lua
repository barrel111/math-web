local M = {}

-- JSON strings are also JavaScript strings. Escape '<' to prevent replacement
-- text from terminating an inline HTML script; preserve control characters.
function M.quote(value)
  local escaped = value:gsub('[%z\1-\31\\"<]', function(char)
    if char == "\\" then return "\\\\" end
    if char == '"' then return '\\"' end
    return string.format("\\u%04x", char:byte())
  end)
  escaped = escaped:gsub("\226\128\168", "\\u2028"):gsub("\226\128\169", "\\u2029")
  return '"' .. escaped .. '"'
end

return M
