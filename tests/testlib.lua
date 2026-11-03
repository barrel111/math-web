local M = {passed = 0, failed = 0}

function M.equal(actual, expected)
  assert(actual == expected,
    string.format("expected %q, got %q", tostring(expected), tostring(actual)))
end

function M.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    M.passed = M.passed + 1
    print("PASS " .. name)
  else
    M.failed = M.failed + 1
    print("FAIL " .. name .. ": " .. tostring(err))
  end
end

function M.finish()
  print(string.format("\n%d passed; %d failed", M.passed, M.failed))
  os.exit(M.failed == 0 and 0 or 1)
end

return M
