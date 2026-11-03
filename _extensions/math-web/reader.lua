local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local extract = dofile(directory .. "extract.lua")
local M = {}

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
  return setmetatable({
    text = text,
    position = 1,
    source = source,
    source_name = source_name or "<string>",
    source_offsets = source_offsets,
  }, {__index = M})
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
  position = position or reader.position
  local source_offset = reader.source_offsets[position] or (#reader.source + 1)
  return source_location(reader.source, source_offset)
end

local function format_error(reader, message, position)
  local line, column = reader_location(reader, position)
  return string.format("%s:%d:%d: %s", reader.source_name, line, column, message)
end

-- Invocation arguments deliberately require braces for m. An absent o is false.
local function read_arguments(reader, specifications)
  local arguments = {}
  for index, specification in ipairs(specifications) do
    skip_whitespace(reader)
    local value, message
    if specification == "m" then
      value, message = read_braced(reader)
      if value == nil then return nil, message end
    elseif specification == "o" or type(specification) == "table" then
      if current_character(reader) == "[" then
        value, message = read_bracketed(reader)
        if value == nil then return nil, message end
      else
        if specification == "o" then value = false else value = specification.default end
      end
    else
      return nil, "unsupported invocation argument specification"
    end
    arguments[index] = value
  end
  return arguments
end

M.new = new_reader
M.skip_whitespace = skip_whitespace
M.read_command = read_command
M.read_group = read_group
M.read_braced = read_braced
M.read_bracketed = read_bracketed
M.peek = current_character
M.location = reader_location
M.error = format_error
M.read_arguments = read_arguments
return M
