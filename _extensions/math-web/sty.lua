local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local parser = dofile(directory .. "parse.lua")
local mappings = dofile(directory .. "mappings.lua")
local transforms = dofile(directory .. "transforms.lua")
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
    fail("configure 'math-web.macros', 'math-web.hooks', or 'math-web.mappings'")
  end
  for _, key in ipairs({"filter", "include"}) do
    if settings[key] ~= nil then
      fail("'math-web." .. key .. "' has been removed; delete this setting; all imported definitions are always available")
    end
  end
  local allowed = {macros = true, hooks = true, mappings = true}
  for key in pairs(settings) do
    if not allowed[key] then
      fail("unknown setting 'math-web." .. tostring(key) .. "'; expected only macros, hooks, or mappings")
    end
  end
  if settings.macros == nil and settings.hooks == nil and settings.mappings == nil then
    fail("configure 'math-web.macros', 'math-web.hooks', or 'math-web.mappings'")
  end
  return settings
end

local function read_path_entries(settings, setting)
  local value = settings[setting]
  if value == nil then return {} end
  if is_metadata_string(value) then
    return {value}
  end
  if pandoc.utils.type(value) == "List" and (#value > 0 or setting == "hooks") then
    return value
  end
  local description = setting == "macros" and "a .sty path or a nonempty ordered list of paths"
    or "a Lua module path or an ordered list of paths"
  fail("'math-web." .. setting .. "' must be " .. description)
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

local function resolve_style_paths(entries, setting)
  setting = setting or "macros"
  local description = setting == "macros" and "a .sty path" or "a Lua module path"
  local paths = {}
  local document_directory = pandoc.path.directory(quarto.doc.input_file)
  for index, entry in ipairs(entries) do
    if not is_metadata_string(entry) then
      fail("'math-web." .. setting .. "' entry " .. index .. " must be " .. description)
    end
    local path = pandoc.utils.stringify(entry)
    if path:match("^%s*$") then
      fail("'math-web." .. setting .. "' entry " .. index .. " must not be empty")
    end
    -- Quarto already rebases inherited project paths relative to this document.
    if not pandoc.path.is_absolute(path) then
      path = pandoc.path.join({document_directory, path})
    end
    paths[#paths + 1] = path
  end
  return paths
end

local function has_math(document)
  local found = false
  document:walk({Math = function() found = true end})
  return found
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

local function include_configuration(name, definitions, document)
  local javascript = renderers[name].generate(definitions)
  quarto.doc.include_text("in-header",
    '<script id="math-web-macros">\n' .. javascript .. '</script>\n')
  if name == "katex" then
    if has_math(document) then
      local method = PANDOC_WRITER_OPTIONS.html_math_method
      local url = type(method) ~= "string" and method.url or nil
      document.meta.math = pandoc.MetaBlocks({pandoc.RawBlock("html", renderers.katex.html_math(url))})
    end
    -- Quarto creates this object in its template after the header includes.
    -- Replace only its document-typesetting entry point, leaving KaTeX intact.
    quarto.doc.include_text("after-body", '<script id="math-web-katex-quarto">\n'
      .. 'globalThis.Quarto = globalThis.Quarto || {};\n'
      .. 'globalThis.Quarto.typesetMath = MathWebKatex.typeset;\n</script>\n')
  end
end

local function transform_document(document, settings, renderer)
  if settings.hooks == nil then return document end
  local handlers = {}
  local paths = resolve_style_paths(read_path_entries(settings, "hooks"), "hooks")
  for _, path in ipairs(paths) do
    local ok, module = pcall(dofile, path)
    if not ok then fail("loading hook " .. path .. ": " .. tostring(module)) end
    local added, message = pcall(transforms.add, handlers, module)
    if not added then fail(path .. ": " .. tostring(message)) end
  end
  if next(handlers) == nil then return document end
  local index = 0
  local function rewrite(text, display, block)
    index = index + 1
    local source = quarto.doc.input_file .. " (math fragment " .. index .. ")"
    local ok, result, changed = pcall(transforms.transform, text, handlers,
      {renderer = renderer, display = display}, source, block)
    if not ok then fail(tostring(result)) end
    return result, changed
  end
  return document:walk({
    Math = function(math)
      math.text = rewrite(math.text, math.mathtype == "DisplayMath", false)
      return math
    end,
    RawBlock = function(raw)
      if raw.format ~= "tex" and raw.format ~= "latex" then return nil end
      local result, changed = rewrite(raw.text, true, true)
      if changed then return pandoc.Para({pandoc.Math("DisplayMath", result)}) end
    end,
  })
end

local function convert_document(document)
  if not quarto.doc.is_format("html") then return document end

  local settings = read_settings(document)
  local entries = read_path_entries(settings, "macros")
  local name = renderer_name()
  local paths = resolve_style_paths(entries)
  local definitions, message = {}
  if #paths > 0 then
    local report
    definitions, message, report = parser.parse_files(paths)
    if not definitions then fail(message) end
    for _, warning in ipairs(report.warnings) do
      quarto.log.warning(string.format("%s:%d:%d: %s: %s", warning.source,
        warning.line, warning.column, warning.kind, warning.message))
    end
  end

  definitions, message = mappings.apply(definitions, read_mappings(settings))
  if not definitions then fail(message) end
  document = transform_document(document, settings, name)
  include_configuration(name, definitions, document)
  return document
end

return {{Pandoc = convert_document}}
