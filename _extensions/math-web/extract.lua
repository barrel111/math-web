local function missing_open_message(opening)
  return "didn't find '" .. opening .. "' at initial position"
end

local function unclosed_message(opening, closing)
  return "found `" .. opening .. "' without a matching '" .. closing .. "'"
end

-- Braces protect brackets in defaults such as [{x]y}]. Escaped delimiters
-- are control symbols rather than grouping tokens.
local function extract_delimited(text, position, opening, closing)
  if text:sub(position, position) ~= opening then
    return nil, missing_open_message(opening)
  end

  local content_start = position + 1
  local delimiter_depth = 1
  local brace_depth = 0
  local bracketed = opening == "["
  position = content_start

  while delimiter_depth > 0 and position <= #text do
    local character = text:sub(position, position)
    if character == "\\" then
      position = position + 1
    elseif bracketed and character == "{" then
      brace_depth = brace_depth + 1
    elseif bracketed and character == "}" and brace_depth > 0 then
      brace_depth = brace_depth - 1
    elseif brace_depth == 0 and character == opening then
      delimiter_depth = delimiter_depth + 1
    elseif brace_depth == 0 and character == closing then
      delimiter_depth = delimiter_depth - 1
    end
    position = position + 1
  end

  if delimiter_depth > 0 then
    return nil, unclosed_message(opening, closing)
  end
  return text:sub(content_start, position - 2), position
end

local function extract_braced(text, position)
  return extract_delimited(text, position, "{", "}")
end

local function extract_bracketed(text, position)
  return extract_delimited(text, position, "[", "]")
end

local function extract_cmd_name(text, position)
  if text:sub(position, position) ~= "\\" then
    return nil, "missing `\\`"
  end

  local name_start = position + 1
  local first_character = text:sub(name_start, name_start)
  if first_character == "" or first_character:match("%s") then
    return nil, "missing command name after `\\`"
  end
  if not first_character:match("[A-Za-z]") then
    return first_character, name_start + 1
  end

  position = name_start
  while text:sub(position, position):match("[A-Za-z]") do
    position = position + 1
  end
  return text:sub(name_start, position - 1), position
end

local function extract_whitespace(text, position)
  while text:sub(position, position):match("[ \t\r\n\v\f]") do
    position = position + 1
  end
  return nil, position
end

return {
  extract_braced = extract_braced,
  extract_bracketed = extract_bracketed,
  extract_cmd_name = extract_cmd_name,
  extract_whitespace = extract_whitespace,
}
