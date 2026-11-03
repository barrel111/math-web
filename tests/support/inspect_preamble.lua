local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local modules = directory .. "../../_extensions/math-web/"
local parser = dofile(modules .. "parse.lua")
local mappings = dofile(modules .. "mappings.lua")
local json = dofile(modules .. "json.lua")
local cli = dofile(directory .. "../../scripts/converter_cli.lua")
local options = cli.parse_arguments(arg)
assert(options and not options.output, "usage: inspect_preamble.lua --input FILE [--input FILE ...] [--map SOURCE=TARGET]")
local definitions, message, report = parser.parse_files(options.inputs)
report = report or {complete = false, diagnostics = {{kind = "unsupported syntax", message = message}}}
if definitions then
  definitions, message = mappings.apply(definitions, options.mappings)
  if not definitions then
    report.diagnostics[#report.diagnostics + 1] = {kind = "invalid mapping", message = message}
  else
    report.definitions = definitions
    report.javascript = {}
    for _, engine in ipairs({"mathjax", "katex"}) do
      report.javascript[engine] = dofile(modules .. engine .. ".lua").generate(definitions)
    end
  end
end
io.write(json.encode(report), "\n")
