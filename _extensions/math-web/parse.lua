-- A declaration reader, not a TeX interpreter.
local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local extract = dofile(directory .. "extract.lua")
local packages = dofile(directory .. "packages.lua")
local M = {}

local declaration_rules = {
  newcommand = {action = "new", arguments = "classic"},
  providecommand = {action = "provide", arguments = "classic"},
  renewcommand = {action = "renew", arguments = "classic"},
  DeclarePairedDelimiter = {action = "new", arguments = "paired", kind = "paired"},
  DeclarePairedDelimiterX = {action = "new", arguments = "paired-x", kind = "paired"},
  DeclareMathOperator = {action = "new", arguments = "none", kind = "operator"},
  NewDocumentCommand = {action = "new", arguments = "signature"},
  RenewDocumentCommand = {action = "renew", arguments = "signature"},
  DeclareDocumentCommand = {action = "declare", arguments = "signature"},
}

local function trim(text)
  return text:match("^%s*(.-)%s*$")
end

-- Remove TeX comments, including their line endings. Retain original byte
-- offsets so diagnostics still point into the input rather than cleaned text.
local function remove_comments(source)
  local characters, source_offsets = {}, {}
  local position = 1
  local function keep_character()
    characters[#characters + 1] = source:sub(position, position)
    source_offsets[#source_offsets + 1] = position
    position = position + 1
  end
  while position <= #source do
    local char = source:sub(position, position)
    if char == "\\" then
      keep_character()
      if source:sub(position, position):match("[A-Za-z]") then
        while source:sub(position, position):match("[A-Za-z]") do keep_character() end
        -- A comment terminates a control word in TeX. Removing it must not
        -- join that word to letters on the next line (\alpha%...\nx).
        if source:sub(position, position) == "%" then
          characters[#characters + 1] = " "
          source_offsets[#source_offsets + 1] = position
        end
      elseif position <= #source then
        keep_character()
      end
    elseif char == "%" then
      while position <= #source and not source:sub(position, position):match("[\r\n]") do
        position = position + 1
      end
      if source:sub(position, position) == "\r" then position = position + 1 end
      if source:sub(position, position) == "\n" then position = position + 1 end
      -- TeX ignores indentation at the start of the following line.
      while source:sub(position, position):match("[ \t]") do position = position + 1 end
    else
      keep_character()
    end
  end
  source_offsets[#characters + 1] = #source + 1
  return table.concat(characters), source_offsets
end

local function source_location(source, offset)
  local prefix = source:sub(1, offset - 1)
  local _, line_count = prefix:gsub("\n", "")
  local last_newline = prefix:match(".*()\n") or 0
  return line_count + 1, offset - last_newline
end

local function new_reader(source, source_name)
  local text, source_offsets = remove_comments(source)
  return {
    text = text,
    position = 1,
    source = source,
    source_name = source_name or "<string>",
    source_offsets = source_offsets,
  }
end

local function skip_whitespace(reader)
  local _, next_position = extract.extract_whitespace(reader.text, reader.position)
  reader.position = next_position
end

local function read_command(reader)
  local name, next_position = extract.extract_cmd_name(reader.text, reader.position)
  if not name then return nil, next_position end
  reader.position = next_position
  return name
end

local function read_group(reader, extractor)
  skip_whitespace(reader)
  local contents, next_position = extractor(reader.text, reader.position)
  if contents == nil then return nil, next_position end
  reader.position = next_position
  return contents
end

local function read_braced(reader)
  return read_group(reader, extract.extract_braced)
end

local function read_bracketed(reader)
  return read_group(reader, extract.extract_bracketed)
end

local function current_character(reader)
  return reader.text:sub(reader.position, reader.position)
end

local function reader_location(reader, position)
  local source_offset = reader.source_offsets[position] or (#reader.source + 1)
  return source_location(reader.source, source_offset)
end

local function format_error(reader, message, position)
  local line, column = reader_location(reader, position)
  return string.format("%s:%d:%d: %s", reader.source_name, line, column, message)
end

local function read_macro_name(reader)
  if current_character(reader) ~= "{" then
    local position = reader.position
    local name, message = read_command(reader)
    return name, message, position
  end

  local contents, message = read_braced(reader)
  if not contents then return nil, message end
  contents = trim(contents)
  local name, next_position = extract.extract_cmd_name(contents, 1)
  if not name or next_position ~= #contents + 1 then
    return nil, "expected exactly one command name in braces"
  end
  return name
end

local function validate_declaration(name, action, definitions)
  local previous = definitions[name]
  if action == "renew" and not previous then
    return "cannot renew undefined command \\" .. name
  end
  if action == "new" and previous and previous.kind ~= "relax" then
    return string.format("duplicate definition of \\%s (previous definition at %s:%d:%d)",
      name, previous.source, previous.line, previous.column)
  end
end

local function parse_document_signature(signature)
  local reader = {text = signature, position = 1}
  local arguments = {nargs = 0}

  while reader.position <= #signature do
    skip_whitespace(reader)
    if reader.position > #signature then break end

    local token = current_character(reader)
    reader.position = reader.position + 1
    if token == "m" then
      arguments.nargs = arguments.nargs + 1
    elseif token == "O" and arguments.nargs == 0 then
      local default, message = read_braced(reader)
      if default == nil then
        return nil, "expected a braced default after O: " .. message
      end
      arguments.default = default
      arguments.nargs = 1
    else
      return nil, "unsupported document-command signature: expected only m arguments or a leading O{default}"
    end

    if arguments.nargs > 9 then
      return nil, "document-command signatures support at most nine arguments"
    end
  end
  return arguments
end

local function read_arguments(reader, argument_style)
  skip_whitespace(reader)
  if argument_style == "signature" then
    local signature, message = read_braced(reader)
    if signature == nil then return nil, message end
    return parse_document_signature(signature)
  end

  local arguments = {nargs = 0}
  if argument_style == "none" or current_character(reader) ~= "[" then
    return arguments
  end

  local count, message = read_bracketed(reader)
  if count == nil then return nil, message end
  count = trim(count)
  if not count:match("^[0-9]$") then
    return nil, "argument count must be an integer from 0 to 9"
  end
  arguments.nargs = tonumber(count)

  skip_whitespace(reader)
  if current_character(reader) == "[" then
    if arguments.nargs == 0 then
      return nil, "an optional default requires at least one argument"
    end
    local default
    default, message = read_bracketed(reader)
    if default == nil then return nil, message end
    arguments.default = default
  end
  return arguments
end

local function validate_parameters(body, argument_count, name)
  local position = 1
  while position <= #body do
    local character = body:sub(position, position)
    if character == "\\" then
      position = position + 2
    elseif character == "#" then
      local parameter = body:sub(position + 1, position + 1)
      local valid_number = parameter:match("^[1-9]$") and tonumber(parameter) <= argument_count
      if parameter ~= "#" and not valid_number then
        return "invalid parameter reference #" .. parameter .. " in \\" .. name
      end
      position = position + 2
    else
      position = position + 1
    end
  end
end

local function read_paired_definition(reader, name, extended)
  local argument_count = 1
  if extended then
    local count, message = read_bracketed(reader)
    if not count then return nil, message end
    if not trim(count):match("^[0-9]$") then
      return nil, "paired delimiter argument count must be an integer from 0 to 9"
    end
    argument_count = tonumber(count)
  end
  local opening, message = read_braced(reader)
  if opening == nil then return nil, message end
  local closing
  closing, message = read_braced(reader)
  if closing == nil then return nil, message end
  local body = "#1"
  if extended then
    body, message = read_braced(reader)
    if body == nil then return nil, message end
  end
  message = validate_parameters(body, argument_count, name)
  if message then return nil, message end
  return {name = name, kind = "paired", nargs = argument_count, body = body,
    opening = opening, closing = closing, starred = false}
end

local function read_definition(reader, rule, definitions)
  skip_whitespace(reader)
  local starred = current_character(reader) == "*"
  if starred and rule.arguments == "signature" then
    return nil, "document-command declarations do not take a declaration star"
  end
  if starred then reader.position = reader.position + 1 end
  skip_whitespace(reader)

  local name, message, error_position = read_macro_name(reader)
  if not name then return nil, message, error_position end
  message = validate_declaration(name, rule.action, definitions)
  if message then return nil, message end

  if rule.kind == "paired" then
    if starred then return nil, "paired-delimiter declarations do not take a declaration star" end
    return read_paired_definition(reader, name, rule.arguments == "paired-x")
  end

  local arguments
  arguments, message = read_arguments(reader, rule.arguments)
  if not arguments then return nil, message end

  local body
  body, message = read_braced(reader)
  if body == nil then return nil, message end
  message = validate_parameters(body, arguments.nargs, name)
  if message then return nil, message end

  return {
    name = name,
    kind = rule.kind or "command",
    body = body,
    nargs = arguments.nargs,
    default = arguments.default,
    starred = starred,
    provided = rule.action == "provide" or nil,
  }
end

local function read_optional(reader)
  skip_whitespace(reader)
  if current_character(reader) ~= "[" then return "" end
  return read_bracketed(reader)
end

local function record_location(reader, position, record)
  record.source = reader.source_name
  record.line, record.column = reader_location(reader, position)
  return record
end

local function parse_package_command(reader, command, report, start)
  local options, message = "", nil
  if command == "RequirePackage" then
    options, message = read_optional(reader)
    if options == nil then return nil, message end
  end
  local names
  names, message = read_braced(reader)
  if names == nil then return nil, message end
  if trim(names) == "" then return nil, "empty package or format name" end
  local release
  release, message = read_optional(reader)
  if release == nil then return nil, message end
  if command == "NeedsTeXFormat" and trim(names) ~= "LaTeX2e" then
    return nil, "unsupported TeX format: " .. names
  end
  if command ~= "RequirePackage" then
    report.metadata[#report.metadata + 1] = record_location(reader, start,
      {command = command, name = names, release = release, status = "metadata only"})
    return true
  end
  for name in (names .. ","):gmatch("(.-),") do
    name = trim(name)
    if name == "" then return nil, "empty name in package list" end
    report.packages[#report.packages + 1] = record_location(reader, start,
      {name = name, options = options, release = release})
  end
  return true
end

local function parse_relax_assignment(reader)
  skip_whitespace(reader)
  local name, message = read_command(reader)
  if not name then return nil, message end
  skip_whitespace(reader)
  if current_character(reader) == "=" then reader.position = reader.position + 1 end
  skip_whitespace(reader)
  local target
  target, message = read_command(reader)
  if not target then return nil, message end
  if target ~= "relax" then return nil, "only \\let\\name\\relax assignments are supported" end
  return {name = name, kind = "relax", body = "\\relax", nargs = 0, starred = false}
end

local function new_report()
  return {complete = false, metadata = {}, packages = {}, diagnostics = {}, warnings = {}}
end

local function parse_into(source, source_name, definitions, report)
  local reader = new_reader(source, source_name)
  local function failure(message, position, category)
    report.diagnostics[#report.diagnostics + 1] = record_location(reader, position,
      {kind = category or "unsupported syntax", message = message})
    return nil, format_error(reader, message, position), report
  end
  while true do
    skip_whitespace(reader)
    if reader.position > #reader.text then break end
    local start = reader.position
    local command, message = read_command(reader)
    if not command then return failure(message, start) end
    if command == "endinput" then break end

    if command == "NeedsTeXFormat" or command == "ProvidesPackage" or command == "RequirePackage" then
      local ok, category
      ok, message, category = parse_package_command(reader, command, report, start)
      if not ok then return failure(message, start, category) end
    else
      local rule = declaration_rules[command]
      local definition, error_position
      if command == "let" then
        definition, message = parse_relax_assignment(reader)
      elseif rule then
        definition, message, error_position = read_definition(reader, rule, definitions)
      else
        return failure("unsupported top-level command \\" .. command, start)
      end
      if not definition then return failure(message, error_position or start) end
      local previous = definitions[definition.name]
      if definition.provided and previous and previous.kind == "relax" then definition.provided = nil end
      if not (definition.provided and previous and previous.kind ~= "relax") then
        definitions[definition.name] = record_location(reader, start, definition)
      end
    end
  end
  return definitions, nil, report
end

local function read_file(path)
  local file, message = io.open(path, "rb")
  if not file then return nil, tostring(path) .. ": " .. message end
  local source, read_error = file:read("*a")
  file:close()
  if not source then return nil, tostring(path) .. ": " .. read_error end
  return source
end

local function finish(definitions, report, paths)
  if not packages.resolve(report, paths) then
    local diagnostic = report.diagnostics[1]
    return nil, string.format("%s:%d:%d: %s", diagnostic.source, diagnostic.line,
      diagnostic.column, diagnostic.message), report
  end
  report.complete = true
  return definitions, nil, report
end

function M.parse(source, source_name)
  local report = new_report()
  local definitions, message = parse_into(source, source_name, {}, report)
  if not definitions then return nil, message, report end
  return finish(definitions, report, {source_name or "<string>"})
end

function M.parse_files(paths)
  if type(paths) ~= "table" or #paths == 0 then
    return nil, "expected a nonempty ordered list of style paths"
  end
  local definitions = {}
  local report = new_report()
  for _, path in ipairs(paths) do
    if type(path) ~= "string" or path:match("^%s*$") then
      return nil, "each style path must be a nonempty string"
    end
    local source, message = read_file(path)
    if not source then
      report.diagnostics[#report.diagnostics + 1] = {kind = "missing dependency", source = path, message = message}
      return nil, message, report
    end
    local result
    result, message = parse_into(source, path, definitions, report)
    if not result then return nil, message, report end
  end
  return finish(definitions, report, paths)
end

function M.parse_file(path)
  return M.parse_files({path})
end

return M
