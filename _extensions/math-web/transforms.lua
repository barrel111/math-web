local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local readers = dofile(directory .. "reader.lua")
local M = {}

local function validate(handlers, commands)
  assert(type(handlers) == "table", "handlers must be a table")
  for name, handler in pairs(handlers) do
    assert(type(name) == "string" and name:match("^[%w@*%-]+$"), "invalid handler name")
    if commands then
      local token = readers.new("\\" .. name)
      assert(token:read_command() == name and token.position > #token.text, "invalid command handler name: " .. name)
    end
    assert(type(handler) == "table" and type(handler.render) == "function", name .. " needs a render function")
    local arguments = handler.arguments or {}
    assert(type(arguments) == "table", name .. " arguments must be a list")
    local count = 0
    for index, specification in pairs(arguments) do
      count = count + 1
      assert(type(index) == "number" and index >= 1 and index <= #arguments and index % 1 == 0,
        name .. " arguments must be a list")
      assert(specification == "m" or specification == "o"
        or (type(specification) == "table" and type(specification.default) == "string"),
        name .. " arguments support only m, o, and {default = text}")
    end
    assert(count == #arguments and count <= 9, name .. " supports at most nine arguments")
  end
end

function M.add(handlers, module)
  assert(type(module) == "table" and type(module.environments) == "table",
    "hook module must return {environments = {...}}")
  validate(module.environments)
  for name, handler in pairs(module.environments) do
    assert(not handlers[name], "duplicate environment handler: " .. name)
    handlers[name] = handler
  end
end

local function require_value(reader, value, message, position)
  assert(value ~= nil, reader:error(message or "missing value", position or reader.position))
  return value
end

local function invocation(reader, name, handler, position)
  local args, message = reader:read_arguments(handler.arguments or {})
  require_value(reader, args, message, position)
  local line, column = reader:location(position)
  return {name = name, args = args, source = reader.source_name, line = line, column = column}
end

local function render(reader, handler, node, context, position)
  local ok, result = pcall(handler.render, node, context)
  assert(ok, reader:error("handler for " .. node.name .. ": " .. tostring(result), position))
  assert(type(result) == "string", reader:error("handler for " .. node.name .. " must return TeX text", position))
  return result
end

-- Keep control words separate across replacements, including empty ones.
-- A space terminates the word without introducing a math group or atom.
local function join_tex(parts)
  local output, state = {}, "text"
  for _, part in ipairs(parts) do
    -- KaTeX also accepts @ in control words. Parts contain complete unchanged
    -- source spans, so separators are inserted only at replacement boundaries.
    if state == "word" and part:match("^[A-Za-z@]") then
      output[#output + 1] = " "
      state = "text"
    end
    output[#output + 1] = part
    for position = 1, #part do
      local char = part:sub(position, position)
      if state == "comment" then
        if char == "\r" or char == "\n" then state = "text" end
      elseif state == "escape" then
        state = char:match("[A-Za-z@]") and "word" or "text"
      elseif state ~= "word" or not char:match("[A-Za-z@]") then
        if char == "\\" then state = "escape"
        elseif char == "%" then state = "comment"
        else state = "text" end
      end
    end
  end
  return table.concat(output)
end

-- Rewrite command invocations without expanding TeX. Handlers own their meaning.
function M.commands(source, handlers, context, source_name)
  validate(handlers, true)
  local reader = readers.new(source, source_name)
  local parts, changed, segment_start = {}, false, 1
  while reader.position <= #reader.text do
    local start = reader.position
    if reader:peek() == "\\" then
      local name = reader:read_command()
      if name and handlers[name] then
        parts[#parts + 1] = reader.text:sub(segment_start, start - 1)
        local node = invocation(reader, name, handlers[name], start)
        parts[#parts + 1] = render(reader, handlers[name], node, context or {}, start)
        segment_start = reader.position
        changed = true
      else
        if not name then reader.position = start + 2 end
      end
    else
      reader.position = start + 1
    end
  end
  parts[#parts + 1] = reader.text:sub(segment_start)
  return changed and join_tex(parts) or source
end

function M.transform(source, handlers, options, source_name, block)
  validate(handlers)
  local reader = readers.new(source, source_name)
  local context = {renderer = options.renderer, display = options.display}
  context.commands = function(text, commands)
    return M.commands(text, commands, context, reader.source_name .. " (handler body)")
  end
  local changed = false
  local sequence, environment

  environment = function(name, start, depth)
    assert(depth <= 64, reader:error("registered environment nesting exceeds 64", start))
    local handler = handlers[name]
    local node = invocation(reader, name, handler, start)
    node.body = sequence(name, depth)
    changed = true
    return render(reader, handler, node, context, start)
  end

  sequence = function(closing, depth)
    local parts, segment_start = {}, reader.position
    while reader.position <= #reader.text do
      local start = reader.position
      if reader:peek() == "\\" then
        local command = reader:read_command()
        if command == "begin" or command == "end" then
          local after_command = reader.position
          local name = reader:read_braced()
          if name and handlers[name] then
            if command == "end" then
              assert(name == closing, reader:error("unexpected \\end{" .. name .. "}; expected " .. tostring(closing), start))
              parts[#parts + 1] = reader.text:sub(segment_start, start - 1)
              return join_tex(parts)
            end
            parts[#parts + 1] = reader.text:sub(segment_start, start - 1)
            parts[#parts + 1] = environment(name, start, depth + 1)
            segment_start = reader.position
          else
            -- Unknown markers belong to the renderer, which may construct their
            -- partners by macro expansion. Scan their contents without pairing
            -- them or normalizing their spelling. Failed lookahead consumes nothing.
            if not name then reader.position = after_command end
          end
        else
          if not command then reader.position = start + 2 end
        end
      else
        reader.position = start + 1
      end
    end
    assert(not closing, reader:error("missing \\end{" .. tostring(closing) .. "}", reader.position))
    parts[#parts + 1] = reader.text:sub(segment_start)
    return join_tex(parts)
  end

  if block then
    reader:skip_whitespace()
    local start = reader.position
    if reader:read_command() ~= "begin" then return source, false end
    local name = reader:read_braced()
    if not name or not handlers[name] then return source, false end
    local result = environment(name, start, 1)
    reader:skip_whitespace()
    assert(reader.position > #reader.text, reader:error("custom raw environment must occupy the entire block", reader.position))
    return result, true
  end
  local result = sequence(nil, 0)
  return changed and result or source, changed
end

return M
