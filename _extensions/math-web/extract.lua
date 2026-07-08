---@diagnostic disable: unused-function

local MISSING_S_BRACE = "didn't find '{' at initial position"
local MISMATCH_O_BRACES = "found `{' without a matching '}'"
local O_BRACE = 123
local C_BRACE = 125

local MISSING_SLASH = "missing `\\`"
local SLASH = 92

-- for the moment, we don't deal with the edge case of escaped braces
-- \{ \}
local function extract_braced(text, pos)
  if not (string.byte(text, pos) == O_BRACE) then
    return nil, MISSING_S_BRACE
  end
  local depth = 1
  local start_pos = pos + 1
  pos = pos + 1
  while depth > 0 and #text >= pos do
    local curr = string.byte(text, pos)
    if curr == O_BRACE then
      depth = depth + 1
    elseif curr == C_BRACE then
      depth = depth - 1
    end
    pos = pos + 1
  end

  if depth > 0 then
    return nil, MISMATCH_O_BRACES
  end
  local braced = string.sub(text, start_pos, pos - 2)
  return braced, pos
end

-- for the moment, we don't deal with the edge case of escaped backslashes
-- \\
local function extract_cmd_name(text, pos)
  if not (string.byte(text, pos) == SLASH) then
    return nil, MISSING_SLASH
  end
  local start_pos = pos + 1
  pos = pos + 1
  local alpha = false
  repeat
    local curr = string.byte(text, pos)
    alpha = (curr >= 65 and curr <= 90) or (curr >= 97 and curr <= 122)
    pos = pos + 1
  until not alpha or #text < pos
  local cmd_name = string.sub(text, start_pos, pos - 2)
  return cmd_name, pos - 1
end

local function extract_whitespace(text, pos)
  local whitespace = false
  repeat
    local curr = string.byte(text, pos)
    whitespace = (curr == 32) or (curr >= 9 and curr <= 13)
    pos = pos + 1
  until not whitespace or #text < pos
  return nil, pos - 1
end
