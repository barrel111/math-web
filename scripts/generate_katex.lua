local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local katex = dofile(directory .. "../_extensions/math-web/katex.lua")
dofile(directory .. "converter_cli.lua").run(katex, arg, "scripts/generate_katex.lua")
