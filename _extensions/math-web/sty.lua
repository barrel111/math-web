local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local parser = dofile(directory .. "parse.lua")
local usage = dofile(directory .. "usage.lua")
local mappings = dofile(directory .. "mappings.lua")
local renderers = {
  mathjax = dofile(directory .. "mathjax.lua"),
  katex = dofile(directory .. "katex.lua"),
}

local function fail(message)
  -- Quarto 1.7 replaces error() with a logger; assert() actually aborts rendering.
  assert(false, "math-web: " .. message)
end

local function is_metadata_string(value)
  local value_type = pandoc.utils.type(value)
  return value_type == "Inlines" or value_type == "string"
end

local function read_settings(document)
  local settings = document.meta["math-web"]
  if not settings or pandoc.utils.type(settings) ~= "table" then
    fail("set 'math-web.macros' to a .sty path or a nonempty ordered list of paths")
  end
  return settings
end

local function read_style_entries(settings)
  local macros = settings.macros
  if macros and is_metadata_string(macros) then
    return {macros}
  end
  if macros and pandoc.utils.type(macros) == "List" and #macros > 0 then
    return macros
  end
  fail("'math-web.macros' must be a .sty path or a nonempty ordered list of paths")
end

local function renderer_name()
  local method = PANDOC_WRITER_OPTIONS.html_math_method
  local name = method
  if type(method) ~= "string" then name = method and method.method end
  if not renderers[name] then
    fail("HTML output requires 'html-math-method: mathjax' or 'html-math-method: katex'")
  end
  return name
end

local function resolve_style_paths(entries)
  local paths = {}
  local document_directory = pandoc.path.directory(quarto.doc.input_file)
  for index, entry in ipairs(entries) do
    if not is_metadata_string(entry) then
      fail("'math-web.macros' entry " .. index .. " must be a .sty path")
    end
    local path = pandoc.utils.stringify(entry)
    if path:match("^%s*$") then
      fail("'math-web.macros' entry " .. index .. " must not be empty")
    end
    -- Quarto already rebases inherited project paths relative to this document.
    if not pandoc.path.is_absolute(path) then
      path = pandoc.path.join({document_directory, path})
    end
    paths[#paths + 1] = path
  end
  return paths
end

local function filtering_enabled(settings)
  if settings.filter == nil then return true end
  if type(settings.filter) ~= "boolean" then
    fail("'math-web.filter' must be true or false")
  end
  return settings.filter
end

local function read_included_names(settings)
  if settings.include == nil then return {} end
  if pandoc.utils.type(settings.include) ~= "List" then
    fail("'math-web.include' must be a list of command names")
  end
  local names = {}
  for index, entry in ipairs(settings.include) do
    if not is_metadata_string(entry) then
      fail("'math-web.include' entry " .. index .. " must be a command name")
    end
    names[#names + 1] = pandoc.utils.stringify(entry)
  end
  return names
end

local function collect_math(document)
  local expressions = {}
  document:walk({
    Math = function(math)
      expressions[#expressions + 1] = math.text
    end,
  })
  return expressions
end

local function select_page_definitions(document, settings, definitions)
  local filter = filtering_enabled(settings)
  local includes = read_included_names(settings)
  local expressions = {}
  if filter then expressions = collect_math(document) end

  local selected, message, fallback = usage.select(definitions, expressions, includes)
  if not selected then fail(message) end
  if not filter then return definitions end
  if fallback then quarto.log.warning("math-web: " .. fallback) end
  return selected
end

local function read_mappings(settings)
  if settings.mappings == nil then return {} end
  if pandoc.utils.type(settings.mappings) ~= "table" then
    fail("'math-web.mappings' must be a mapping of command names to command names")
  end
  local mappings = {}
  for name, target in pairs(settings.mappings) do
    if not is_metadata_string(target) then fail("'math-web.mappings' targets must be command names") end
    mappings[name] = pandoc.utils.stringify(target)
  end
  return mappings
end

local function include_configuration(name, definitions)
  if name == "katex" then
    -- Outrank KaTeX's later-loaded 1.21em rule without changing relative TeX sizes.
    quarto.doc.include_text("in-header",
      '<style id="math-web-font-size">.math .katex { font-size: 1em; }</style>\n')
  end
  local javascript = renderers[name].generate(definitions)
  quarto.doc.include_text("in-header",
    '<script id="math-web-macros">\n' .. javascript .. '</script>\n')
end

local function convert_document(document)
  if not quarto.doc.is_format("html") then return document end

  local settings = read_settings(document)
  local entries = read_style_entries(settings)
  local name = renderer_name()
  local paths = resolve_style_paths(entries)
  local definitions, message, report = parser.parse_files(paths)
  if not definitions then fail(message) end
  for _, warning in ipairs(report.warnings) do
    quarto.log.warning(string.format("%s:%d:%d: %s: %s", warning.source,
      warning.line, warning.column, warning.kind, warning.message))
  end

  definitions, message = mappings.apply(definitions, read_mappings(settings))
  if not definitions then fail(message) end
  definitions = select_page_definitions(document, settings, definitions)
  include_configuration(name, definitions)
  return document
end

return {{Pandoc = convert_document}}
