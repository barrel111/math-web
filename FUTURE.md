# Roadmap

## v1 — parser, MathJax
- write a simple parser for LaTeX using Quarto hooks
- recognizes `\newcommand`, `\renewcommand`, `\DeclareMathOperator`
- takes a single .sty file and unconditionally generates MathJax

## v2 — usage filtering
- scan all `.qmd` files in the project for macro invocations
- only emit macros that are actually used
- warn on macros defined but never called (option-controlled, in quarto consolex)

## v3 — KaTeX, cosmetic
- generate KaTeX
- support multiple `.sty` files
