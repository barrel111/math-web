# Tests

Requires Node.js 20+, npm, LuaJIT (or Lua), and Quarto 1.7+.
From the repository root:

```sh
npm ci --prefix tests --ignore-scripts
npm test --prefix tests
```

`npm test` runs `run.sh`, which runs the Lua checks, converter/renderer checks,
and Quarto integration checks. It sets the working directory to the repository
root and exits nonzero on failure. `sh tests/run.sh` is the same entry point.
Set `LUA` or `QUARTO` to select another executable:

```sh
LUA=lua QUARTO=/path/to/quarto npm test --prefix tests
```

## Focused checks

Run individual files from the repository root:

```sh
luajit tests/parsing/parse_test.lua
luajit tests/custom-environments/transform_test.lua
node --test tests/katex/config_test.cjs
node --test tests/custom-environments/quarto_test.cjs
```

## Layout

| Location | Purpose |
| --- | --- |
| `parsing/` | Readers, declaration state, argument syntax, and diagnostics |
| `mathjax/`, `katex/` | Generated configuration, expression rendering, and document integration |
| `multiple-files/`, `imports/` | Ordered input files, complete imports, paths, and migration errors |
| `package-dependencies/`, `renderer-contract/` | Dependency policy and the supported parser/renderer boundary |
| `custom-environments/` | Hook arguments, nesting, token boundaries, configuration, and public examples |
| `sample-preamble/` | Notation regression cases with explicit expected expansions |
| `fixtures/` | Fixed repository-owned inputs; tests never read the ignored root `sample-preamble/` |
| `support/` | Shared temporary workspaces, Quarto invocation, renderer compilation, and declaration inspection/auditing |

Test names and assertions specify the expected behavior. `render_cases.cjs` and
`sample-preamble/cases.json` pair invocations with independently written expansions.
When adding a regression, keep its input and expected behavior in the relevant
suite; put reusable setup in `support/`.

## What the checks establish

Renderer checks compare generated MathML against the same engine's explicit
expansion, ignoring source-text metadata. Each independent case uses fresh
renderer state; tests of shared macro state make that sharing explicit.
MathJax and KaTeX need not produce identical output or support the same commands.

Quarto checks render temporary copies of the extension and fixtures, then inspect
the generated configuration and math. KaTeX integration also executes the page's
math scripts in jsdom using the pinned local renderer. These checks run without
network access after dependency installation and clean up their temporary files.
Browser typography and layout remain manual checks; passing expressions do not
establish support for arbitrary LaTeX programs.
