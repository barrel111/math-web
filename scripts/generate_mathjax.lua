local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])") or "./"
local mathjax = dofile(directory .. "../_extensions/math-web/mathjax.lua")
dofile(directory .. "converter_cli.lua").run(mathjax, arg, "scripts/generate_mathjax.lua")
