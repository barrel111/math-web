local extract = dofile("_extensions/math-web/extract.lua")
local passed, failed = 0, 0

local function equal(actual, expected)
  assert(actual == expected,
    string.format("expected %q, got %q", tostring(expected), tostring(actual)))
end

local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    print("PASS " .. name)
  else
    failed = failed + 1
    print("FAIL " .. name .. ": " .. tostring(err))
  end
end

local function result(name, fn, input, pos, value, next_pos)
  check(name, function()
    local actual, cursor = fn(input, pos)
    equal(actual, value)
    equal(cursor, next_pos)
  end)
end

local function rejects(name, fn, input, pos)
  check(name, function()
    local value, diagnostic = fn(input, pos)
    equal(value, nil)
    assert(type(diagnostic) == "string" and #diagnostic > 0,
      "expected a nonempty diagnostic")
  end)
end

-- Successful extraction returns the first unconsumed position, including #s + 1
-- when the input is exhausted. Rejection returns nil and a diagnostic.
result("braced body", extract.extract_braced, "{x}tail", 1, "x", 4)
result("nested body", extract.extract_braced, "{{x}{y}}!", 1, "{x}{y}", 9)
result("empty body", extract.extract_braced, "{}", 1, "", 3)
result("body at offset", extract.extract_braced, "xx{a}", 3, "a", 6)
result("brackets inside braces", extract.extract_braced, "{[x]}", 1, "[x]", 6)
result("nested brackets", extract.extract_bracketed, "[[x]]!", 1, "[x]", 6)
result("empty brackets", extract.extract_bracketed, "[]", 1, "", 3)
rejects("missing opening brace", extract.extract_braced, "x}", 1)
rejects("unclosed body", extract.extract_braced, "{x", 1)
rejects("unclosed nested body", extract.extract_braced, "{{x}", 1)
rejects("unclosed brackets", extract.extract_bracketed, "[x", 1)
rejects("empty braced input", extract.extract_braced, "", 1)
result("command before argument", extract.extract_cmd_name, "\\foo{x}", 1, "foo", 5)
result("command at offset", extract.extract_cmd_name, "x\\Foo!", 2, "Foo", 6)
result("command stops before digit", extract.extract_cmd_name, "\\foo2", 1, "foo", 5)
rejects("missing command slash", extract.extract_cmd_name, "foo", 1)
result("command at end of input", extract.extract_cmd_name, "\\foo", 1, "foo", 5)
result("single-letter command at end", extract.extract_cmd_name, "\\x", 1, "x", 3)
rejects("bare command slash", extract.extract_cmd_name, "\\", 1)
result("mixed whitespace", extract.extract_whitespace, " \t\n\r\v\fx", 1, nil, 7)
result("no whitespace", extract.extract_whitespace, "x", 1, nil, 1)
result("whitespace at offset", extract.extract_whitespace, "x  y", 2, nil, 4)
result("whitespace at end of input", extract.extract_whitespace, " \t", 1, nil, 3)
result("empty whitespace input", extract.extract_whitespace, "", 1, nil, 1)
result("whitespace cursor past input", extract.extract_whitespace, "x", 2, nil, 2)
result("escaped closing brace", extract.extract_braced, "{a\\}b}!", 1, "a\\}b", 7)
result("escaped opening brace", extract.extract_braced, "{\\{x}!", 1, "\\{x", 6)
result("paired backslashes before closing brace", extract.extract_braced, "{x\\\\}!", 1, "x\\\\", 6)
result("braced closing bracket", extract.extract_bracketed, "[{x]y}]!", 1, "{x]y}", 8)
result("control symbol", extract.extract_cmd_name, "\\%x", 1, "%", 3)
rejects("whitespace after command slash", extract.extract_cmd_name, "\\ ", 1)

print(string.format("\n%d passed; %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
