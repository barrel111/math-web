# math for quarto

> AI was used extensively to help design and implement
> this project 

Use LaTeX macros from `.sty` files in Quarto HTML with MathJax or KaTeX.
The extension also supports named operators, paired delimiters, and Lua hooks
for custom math environments.

## Quick start

Install the extension (requires Quarto 1.7 or newer):

```sh
quarto add barrel111/math-web
```

Create `macros.sty`:

```latex
\newcommand{\RR}{\mathbb{R}}
```

Use it in `example.qmd`:

```markdown
---
format: math-web-html
math-web:
  macros: macros.sty
---

The real numbers are $\RR$.
```

Render the document:

```sh
quarto render example.qmd
```

MathJax is the default. For KaTeX, add `html-math-method: katex` to the YAML.
To keep an existing HTML format, [enable the filter directly](docs/quarto.md#use-an-existing-html-format).

## Documentation

| Guide | Covers |
| --- | --- |
| [Quarto configuration](docs/quarto.md) | Settings, multiple style files, paths, and command mappings |
| [Supported declarations](docs/declarations.md) | Macro syntax, operators, delimiters, package handling, and renderer limits |
| [Custom environments](docs/hooks.md) | Writing Lua hooks and transforming math |
| [Standalone generation](docs/standalone.md) | Converting style files for use outside Quarto |

## Examples and development

The [examples](examples/) cover both renderers, multiple files, and custom
environments. From this repository, try:

```sh
quarto render examples/example.qmd
```

See the [test guide](tests/README.md) for setup and test commands.


