local t = dofile("tests/testlib.lua")
local reader = dofile("_extensions/math-web/reader.lua")
local transforms = dofile("_extensions/math-web/transforms.lua")
local handlers = {}
transforms.add(handlers, {environments = {
  wrap = {arguments = {"o", "m"}, render = function(node)
    return "(" .. node.args[2] .. ":" .. node.body .. ")" .. (node.args[1] ~= false and "_{" .. node.args[1] .. "}" or "")
  end},
}})
local function rewrite(text, block)
  return transforms.transform(text, handlers, {renderer = "katex", display = true}, "input", block)
end
local function rejects(name, operation, fragment)
  t.test(name, function()
    local ok, message = pcall(operation)
    t.equal(ok, false)
    assert(tostring(message):find(fragment, 1, true), tostring(message))
  end)
end

t.test("reader preserves original locations through comments", function()
  local input = reader.new("% first\n  \\word", "source")
  input:skip_whitespace()
  local line, column = input:location()
  t.equal(line, 2)
  t.equal(column, 3)
  t.equal(input:read_command(), "word")
end)
t.test("reader handles nested arguments, escaped braces, and protected brackets", function()
  local input = reader.new([[ [{x]y}] {{a}\{b\}} ]])
  local args = assert(input:read_arguments({"o", "m"}))
  t.equal(args[1], "{x]y}")
  t.equal(args[2], [[{a}\{b\}]])
end)
t.test("absent optional values remain false without shifting mandatory arguments", function()
  local args = assert(reader.new("{x}"):read_arguments({"o", "m"}))
  t.equal(args[1], false)
  t.equal(args[2], "x")
  t.equal(assert(reader.new("[]{x}"):read_arguments({"o", "m"}))[1], "")
  t.equal(assert(reader.new("{x}"):read_arguments({{default = "z"}, "m"}))[1], "z")
end)
t.test("registered environments receive parsed arguments and body", function()
  t.equal(rewrite([[a+\begin{wrap}[H]{x}y\end{wrap}+b]]), "a+(x:y)_{H}+b")
end)
t.test("nested environments transform from the inside outward", function()
  t.equal(rewrite([[\begin{wrap}{x}\begin{wrap}{y}z\end{wrap}\end{wrap}]]), "(x:(y:z))")
end)
t.test("unknown environments preserve source exactly when no handler runs", function()
  local text = "\\begin {aligned}x % comment\n\\end {aligned}"
  local output, changed = rewrite(text)
  t.equal(output, text)
  t.equal(changed, false)
end)
t.test("unknown outer environments can contain registered environments", function()
  t.equal(rewrite([[\begin {aligned}\begin{wrap}{x}y\end{wrap}\end {aligned}]]), [[\begin {aligned}(x:y)\end {aligned}]])
end)
t.test("unknown boundaries do not require literal partners even when a handler runs", function()
  for _, text in ipairs({
    [[\begin{matrix}x\matstop]],
    [[\matstart x\end{matrix}]],
    [[\begin{matrix}x\end{other}]],
    [[\begin x]],
    [[\begin{unfinished]],
    [[\end{unfinished]],
  }) do
    local output, changed = rewrite(text)
    t.equal(output, text)
    t.equal(changed, false)
    output, changed = rewrite(text .. [[+\begin{wrap}{a}b\end{wrap}]])
    t.equal(output, text .. "+(a:b)")
    t.equal(changed, true)
  end
end)
t.test("unknown boundaries inside registered bodies belong to the renderer", function()
  t.equal(rewrite([[\begin{wrap}{a}\begin {matrix}x\matstop\end{other}\end{wrap}]]),
    [[(a:\begin {matrix}x\matstop\end{other})]])
end)
t.test("only registered nesting counts toward the depth limit", function()
  local opening, closing = string.rep([[\begin{matrix}]], 65), string.rep([[\end{matrix}]], 65)
  t.equal(rewrite(opening .. [[\begin{wrap}{a}b\end{wrap}]] .. closing), opening .. "(a:b)" .. closing)
end)
t.test("environment output is not scanned again and reader internals stay private", function()
  local output = transforms.transform([[\begin{emit}x\end{emit}]], {
    emit = {render = function(node, context)
      t.equal(node.body, "x")
      t.equal(context.renderer, "katex")
      t.equal(context.display, true)
      t.equal(context.reader, nil)
      return context.commands([[\boundary]], {
        boundary = {render = function() return [[\begin{emit}]] end},
      })
    end},
  }, {renderer = "katex", display = true}, "input")
  t.equal(output, [[\begin{emit}]])
end)
t.test("comments and escaped backslashes do not create environment boundaries", function()
  t.equal(rewrite([[% \begin{broken}
\begin{wrap}{x}\\end{wrap}+y\end{wrap}]]), [[(x:\\end{wrap}+y)]])
end)
t.test("complete registered raw blocks become display math", function()
  local output, changed = rewrite(" \n\\begin{wrap}{x}y\\end{wrap}\n", true)
  t.equal(output, "(x:y)")
  t.equal(changed, true)
  local unknown = [[\begin{unknown}x\end{unknown}]]
  t.equal(rewrite(unknown, true), unknown)
end)
t.test("command handlers share argument parsing and do not expand their own output", function()
  local output = transforms.commands([[\row[{x]y}]{{z}}]], {
    row = {arguments = {{default = ""}, "m"}, render = function(node)
      return "\\row{" .. node.args[2] .. ":" .. node.args[1] .. "}"
    end},
  })
  t.equal(output, [[\row{{z}:{x]y}}]])
end)
t.test("command replacements preserve control words on both sides and across deletions", function()
  local commands = {}
  for name, text in pairs({emit = [[\alpha]], letter = "x", drop = "", row = "&"}) do
    local replacement = text
    commands[name] = {arguments = {"m"}, render = function() return replacement end}
  end
  for _, case in ipairs({
    {[[\emit{}x]], [[\alpha x]]},
    {[[\alpha\letter{}]], [[\alpha x]]},
    {[[\alpha\drop{}\drop{}x]], [[\alpha x]]},
    {[[\emit{}\letter{}]], [[\alpha x]]},
    {[[\emit{}@x]], [[\alpha @x]]},
    {[[\alpha@x+\drop{}y]], [[\alpha@x+y]]},
    {[[\\alpha\letter{}]], [[\\alphax]]},
    {[[\\\alpha\letter{}]], [[\\\alpha x]]},
    {[[\emit{}^2+\emit{}\beta]], [[\alpha^2+\alpha\beta]]},
    {[[\row{}x]], "&x"},
  }) do
    t.equal(transforms.commands(case[1], commands), case[2])
  end
end)
t.test("environment replacements preserve control words without adding math groups", function()
  local environments = {
    emit = {render = function() return [[\alpha]] end},
    letter = {render = function() return "x" end},
    drop = {render = function() return "" end},
    pass = {render = function(node) return node.body end},
  }
  for _, case in ipairs({
    {[[\begin{emit}\end{emit}x]], [[\alpha x]]},
    {[[\begin{emit}\end{emit}@x]], [[\alpha @x]]},
    {[[\alpha@x+\begin{drop}\end{drop}y]], [[\alpha@x+y]]},
    {[[\alpha\begin{letter}\end{letter}]], [[\alpha x]]},
    {[[\alpha\begin{drop}\end{drop}x]], [[\alpha x]]},
    {[[\begin{pass}\begin{emit}\end{emit}x\end{pass}y]], [[\alpha xy]]},
    {[[\\alpha\begin{letter}\end{letter}]], [[\\alphax]]},
  }) do
    t.equal(transforms.transform(case[1], environments, {}, "input"), case[2])
  end
end)
t.test("replacement comments and escaped percent signs retain their token boundaries", function()
  for _, replacement in ipairs({"% \\alpha", "\\alpha% comment\n", [[\%\alpha]]}) do
    local output = transforms.commands([[\emit{}x]], {
      emit = {arguments = {"m"}, render = function() return replacement end},
    })
    local suffix = replacement == [[\%\alpha]] and " x" or "x"
    t.equal(output, replacement .. suffix)
  end
end)
rejects("mandatory invocation arguments require braces", function() rewrite([[\begin{wrap}x y\end{wrap}]]) end, "input:1:1:")
rejects("mismatched registered closing names have locations", function()
  transforms.transform([[\begin{wrap}{x}y\end{other}]], {wrap = handlers.wrap, other = handlers.wrap}, {}, "input")
end, "input:1:17: unexpected \\end{other}")
rejects("unknown closing names cannot close registered environments", function()
  rewrite([[\begin{wrap}{x}y\end{other}]])
end, "missing \\end{wrap}")
rejects("registered closing boundaries must be literal", function()
  rewrite([[\begin{wrap}{x}y\finishwrap]])
end, "missing \\end{wrap}")
rejects("stray registered closing boundaries fail", function() rewrite([[x\end{wrap}]]) end, "unexpected \\end{wrap}")
rejects("registered environment nesting stays bounded", function()
  rewrite(string.rep([[\begin{wrap}{x}]], 65) .. string.rep([[\end{wrap}]], 65))
end, "registered environment nesting exceeds 64")
rejects("unclosed environments report the expected name", function() rewrite([[\begin{wrap}{x}y]]) end, "missing \\end{wrap}")
rejects("raw blocks cannot silently absorb trailing prose", function() rewrite([[\begin{wrap}{x}y\end{wrap} trailing]], true) end, "entire block")
rejects("duplicate registrations fail", function() transforms.add(handlers, {environments = {wrap = handlers.wrap}}) end, "duplicate")
rejects("unsupported signature elements fail at registration", function() transforms.add({}, {environments = {bad = {arguments = {"s"}, render = function() end}}}) end, "arguments support only")
rejects("handler failures retain invocation source", function()
  transforms.transform([[\begin{bad}\end{bad}]], {bad = {render = function() error("reason") end}}, {}, "hook-source")
end, "hook-source:1:1: handler for bad")
rejects("handler return values must be text", function()
  transforms.transform([[\begin{bad}\end{bad}]], {bad = {render = function() return {} end}}, {}, "hook-source")
end, "must return TeX text")
t.finish()
