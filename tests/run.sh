#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
LUA="${LUA:-luajit}"
export LUA

# Readers and transforms.
"$LUA" tests/parsing/extract_test.lua
"$LUA" tests/parsing/parse_test.lua
"$LUA" tests/sample-preamble/parser_test.lua
"$LUA" tests/custom-environments/transform_test.lua

# Converters and renderer behavior.
node --test \
  tests/mathjax/config_test.cjs \
  tests/mathjax/render_test.cjs \
  tests/katex/config_test.cjs \
  tests/katex/render_test.cjs \
  tests/multiple-files/convert_test.cjs \
  tests/sample-preamble/render_test.cjs \
  tests/package-dependencies/policy_test.cjs \
  tests/renderer-contract/contract_test.cjs

# Quarto document integration.
node --test \
  tests/mathjax/quarto_test.cjs \
  tests/katex/quarto_test.cjs \
  tests/imports/quarto_test.cjs \
  tests/sample-preamble/quarto_test.cjs \
  tests/package-dependencies/quarto_test.cjs \
  tests/renderer-contract/quarto_test.cjs \
  tests/custom-environments/quarto_test.cjs
