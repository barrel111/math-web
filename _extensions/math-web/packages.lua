local M = {}

-- These notes describe concrete handling, not a list of permitted packages.
local external_notes = {
  amsmath = "LaTeX package not executed; replacement commands require renderer support",
  amssymb = "LaTeX package not executed; replacement symbols require renderer support",
  mathtools = "paired declarations translated; replacement bodies use the selected renderer profile",
  xparse = "supported document-command signatures translated at build time",
  dsfont = "font package not loaded; replacement bodies require renderer support or explicit user mappings",
}

local function diagnostic(package, kind, message)
  return {kind = kind, source = package.source, line = package.line,
    column = package.column, message = message}
end

function M.resolve(report, paths)
  local supplied = {}
  local function register(name, path)
    if not name then return end
    local candidates = supplied[name] or {}
    candidates[path] = true
    supplied[name] = candidates
  end
  for _, path in ipairs(paths) do
    register(path:match("([^/\\]+)%.sty$"), path)
  end
  for _, metadata in ipairs(report.metadata) do
    if metadata.command == "ProvidesPackage" then
      register(metadata.name:match("^%s*(.-)%s*$"), metadata.source)
    end
  end

  for _, package in ipairs(report.packages) do
    local candidates = supplied[package.name]
    local has_options = package.options:match("%S") ~= nil
    if candidates then
      local first = next(candidates)
      if next(candidates, first) then
        package.status = "ambiguous local dependency"
        report.diagnostics[#report.diagnostics + 1] = diagnostic(package, "missing dependency",
          "multiple supplied files identify package '" .. package.name .. "'")
      elseif has_options then
        package.status = "unsupported local options"
        report.diagnostics[#report.diagnostics + 1] = diagnostic(package, "unsupported syntax",
          "options for supplied local package '" .. package.name .. "' are not supported: " .. package.options)
      else
        package.status = "supplied local dependency"
        package.resolvedSource = first
      end
    else
      package.note = external_notes[package.name]
      package.status = package.note and "external package recorded" or "unresolved package dependency"
      if not package.note then
        report.warnings[#report.warnings + 1] = diagnostic(package, "unresolved package dependency",
          "package '" .. package.name .. "' is not identified by the supplied files or a known external-package note; "
          .. "its definitions are not imported (supply its .sty file explicitly if it is local)")
      end
      if has_options then
        report.warnings[#report.warnings + 1] = diagnostic(package, "unhandled package options",
          "options for package '" .. package.name .. "' are recorded but their effects are not reproduced: " .. package.options)
      end
    end
  end
  return #report.diagnostics == 0
end

return M
