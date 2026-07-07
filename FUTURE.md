# Roadmap

## v1 — Static translation
- User drops a `.sty` file into the project
- A script parses `\newcommand`, `\renewcommand`, `\DeclareMathOperator`
- Outputs a `mathjax-config.html` (replacing the current hardcoded one)
- No filtering, no scanning — just "give me a `.sty`, I'll give you a working config"
- Goal: replicate what we have now but driven by the user's own preamble

## v2 — Usage filtering
- Scan all `.qmd` files in the project for macro invocations
- Only emit macros that are actually used
- Warn on macros defined but never called
- Goal: keep generated config lean, surface dead definitions

## v3 — Quarto integration
- Run the script automatically as a Quarto pre-render hook so users never invoke it manually
- Support multiple `.sty` files
- Better error/skip reporting for patterns we can't translate (e.g. `\xspace`, conditionals)
- Goal: zero-friction drop-in for existing LaTeX workflows
