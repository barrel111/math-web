local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local parser = dofile(directory .. "../_extensions/math-web/parse.lua")
local mappings = dofile(directory .. "../_extensions/math-web/mappings.lua")
local M = {}

local function fail(message)
  io.stderr:write(message, "\n")
  os.exit(1)
end

local function usage_message(script)
  return "usage: luajit " .. script .. " INPUT.sty [OUTPUT.js]\n"
    .. "   or: luajit " .. script .. " --input INPUT.sty [--input NEXT.sty ...] [--output OUTPUT.js] [--map SOURCE=TARGET]"
end

local function is_option(value)
  return value and value:sub(1, 1) == "-"
end

function M.parse_arguments(arguments)
  if arguments[1] and not is_option(arguments[1]) then
    if arguments[3] or is_option(arguments[2]) then return nil end
    return {inputs = {arguments[1]}, output = arguments[2]}
  end

  local options = {inputs = {}, mappings = {}}
  for index = 1, #arguments, 2 do
    local option = arguments[index]
    local value = arguments[index + 1]
    if not value or value == "" or is_option(value) then return nil end

    if option == "--input" then
      options.inputs[#options.inputs + 1] = value
    elseif option == "--map" then
      local source, target = value:match("^([^=]+)=([^=]+)$")
      if not source or options.mappings[source] then return nil end
      options.mappings[source] = target
    elseif (option == "--output" or option == "-o") and not options.output then
      options.output = value
    else
      return nil
    end
  end
  if #options.inputs == 0 then return nil end
  return options
end

local function write_output(path, javascript)
  local file, open_error = io.open(path, "wb")
  if not file then return nil, open_error end

  local written, write_error = file:write(javascript)
  local closed, close_error = file:close()
  if not written then return nil, write_error end
  if not closed then return nil, close_error end
  return true
end

function M.run(renderer, arguments, script)
  local options = M.parse_arguments(arguments)
  if not options then fail(usage_message(script)) end

  local definitions, message, report = parser.parse_files(options.inputs)
  if not definitions then fail(message) end
  for _, warning in ipairs(report.warnings) do
    io.stderr:write(string.format("%s:%d:%d: warning: %s: %s\n", warning.source,
      warning.line, warning.column, warning.kind, warning.message))
  end
  definitions, message = mappings.apply(definitions, options.mappings)
  if not definitions then fail(message) end
  local javascript = renderer.generate(definitions)

  -- Complete parsing and generation before opening an existing destination.
  if options.output then
    local written
    written, message = write_output(options.output, javascript)
    if not written then fail(message) end
  else
    io.write(javascript)
  end
end

return M
