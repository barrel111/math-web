# math for quarto

> **AI assistance:** OpenAI Codex was used extensively to help design and implement
> this project and write its documentation.

Reuse LaTeX macro declarations in Quarto with MathJax or KaTeX.

The scope is mathematical notation rendered by these engines, including
math-only environments where feasible. Document structure, theorem/proof
containers, numbering, cross-references, algorithms, and page layout belong to
other filters or templates. Legacy preamble and problem-set support are out of
scope; importing an entire document preamble is not a goal.

## installing

```bash
quarto add barrel111/math-web
```

This will install the extension under the `_extensions` subdirectory. If you're using version control, you will want to check in this directory.

## example

The [examples](examples/) directory contains MathJax and KaTeX examples sharing
[example-macros.sty](examples/example-macros.sty), plus examples of multiple input
files, per-page filtering, and the supported notation subset. From the repository root:

```sh
quarto render examples/example.qmd
quarto render examples/example-katex.qmd
quarto render examples/example-multiple-files.qmd
quarto render examples/example-filtering.qmd
quarto render examples/example-contract.qmd
```

To select KaTeX for another example, add `-M html-math-method:katex`.
The root `_quarto.yml` lets these nested documents find the installed extension;
running `quarto render` renders the examples.

## using with Quarto

After installing the extension, select its HTML format and a style file in
your document's YAML front matter:

```yaml
---
format: math-web-html
math-web:
  macros: macros.sty
---
```

The format defaults to MathJax. Add `html-math-method: katex` to select KaTeX,
as in [example-katex.qmd](examples/example-katex.qmd). Both examples use the same style file.

Both renderers default to the surrounding text's font size for inline and
display math: KaTeX uses `1em`; MathJax disables automatic x-height matching.
Subscripts, fractions, and explicit TeX size commands retain their normal
relative sizing. Explicit MathJax `chtml` sizing options are preserved.

To combine files, as in
[example-multiple-files.qmd](examples/example-multiple-files.qmd),
we do:

```yaml
math-web:
  macros:
    - notation/base.sty
    - notation/extra.sty
```

Files share declaration state and are read in the listed order. A later
`\renewcommand` or `\RenewDocumentCommand` can replace an earlier definition;
`\DeclareDocumentCommand` can create or replace one. New declarations with an
already defined name are errors, including when the same file is listed twice.
Duplicate errors identify both definition locations. Macro bodies can reference
definitions from any listed file; the final definitions are used when rendered.
`\endinput` stops only its own file. All files must parse successfully before
configuration is emitted. Empty lists and invalid list entries are rejected.

A `\RequirePackage{math-core}` inside a supplied file recognizes `math-core.sty`
in that list. Files are identified by their `.sty` basename and any parsed
`\ProvidesPackage` name. This does not import a file again or reorder declarations;
put dependencies first when later declarations renew their commands. Ambiguous
package identities are errors. Files are not discovered automatically.

The filter reads the style files on each render and embeds the generated
configuration before the renderer loads. No separate generation command or
configuration file is needed. Quarto supplies the Lua runtime; LuaJIT and
Node.js are not required for rendering.

Document-level paths are relative to the document. You can put the same
settings in `_quarto.yml`, where paths are relative to the project root;
Quarto adjusts inherited paths for nested documents. Absolute paths also work.

To use your existing HTML format instead of the extension's theme, enable its
filter explicitly:

```yaml
format:
  html:
    html-math-method: mathjax
filters:
  - math-web
math-web:
  macros: macros.sty
```

Choose either entry point; the custom format already enables the filter.
Missing files, malformed declarations, and invalid settings stop the render
with an error. Both `mathjax` and `katex` are supported; non-HTML formats skip
this filter. MathJax and KaTeX support different built-in commands, so a parsed
macro's replacement body must also be supported by the selected renderer.

## per-page dependency filtering

Quarto builds now emit only the imported commands used in each page's math,
plus their transitive dependencies. Filtering is enabled by default for both
renderers and works across all listed style files. A command used only on a
different page is not included. See [example-filtering.qmd](examples/example-filtering.qmd).

The filter scans Pandoc math nodes, including math in titles, headings, tables,
and footnotes. Inline code, code blocks, ordinary prose, raw HTML, and TeX
comments are not usage roots. Dependencies come from the final replacement
bodies, optional defaults, and paired delimiters; complete command names are matched, so `\RR`
does not retain `\R`. Repeated references emit one definition. Dependency
cycles terminate during filtering, though a recursively expanding macro can
still fail when rendered. All input declarations are validated before filtering,
including ones that are ultimately omitted.

For math inserted by JavaScript or written in raw HTML, explicitly include the
imported commands it needs:

```yaml
math-web:
  macros: macros.sty
  include: [plane, shift]
```

`include` is a list of imported command names, with or without a leading
backslash. Included commands retain their dependencies even if no page math
references them. Unknown names are errors. Math added by a later Lua filter,
or dependencies hidden inside separately configured renderer macros, likewise
need explicit inclusion. This setting supplies definitions; it does not load a
renderer on a page for which Quarto otherwise would not load one.

Set `math-web.filter: false` to preserve every imported definition. For literal
command references, filtering computes the smallest dependency-closed set; it
does not execute TeX or determine which conditional branches run. If page math
or a retained definition uses `\csname` to compute a command name, all imported
definitions are retained and a build diagnostic explains the fallback.

This analysis runs at build time. The website receives the selected definitions,
with no dependency scanner added to its JavaScript. Standalone converter scripts
have no page input and continue to emit all definitions. Unused-definition
warnings are not yet implemented.
Filtering applies to imported definitions, not MathJax's fixed extension profile.

## explicit command mappings

Use mappings to choose aliases for commands in your notation, as in
[example-contract.qmd](examples/example-contract.qmd):

```yaml
math-web:
  macros: contract-macros.sty
  mappings:
    labelstyle: mathsf
```

Mappings associate command names with command names and preserve following
arguments. They cannot overwrite imported definitions. Their targets must be
supported by the selected renderer or defined in the imported files. These are
explicit user choices; the importer does not substitute typography automatically.

## standalone generation

The standalone converter reads supported `.sty` files and emits all
their macros as JavaScript. The original single-file commands still work:

```sh
luajit scripts/generate_mathjax.lua examples/example-macros.sty mathjax-config.js
luajit scripts/generate_katex.lua examples/example-macros.sty katex-config.js
```

For multiple files, repeat `--input` in declaration order and optionally specify
`--output` (or `-o`):

```sh
luajit scripts/generate_mathjax.lua --input examples/example-macros.sty --input examples/extra-macros.sty --output mathjax-config.js
luajit scripts/generate_katex.lua --input examples/example-macros.sty --input examples/extra-macros.sty --output katex-config.js
```

An invalid or missing input leaves an existing output file untouched. These
lists are explicit: the converter does not follow `\input` or `\RequirePackage`.
Use repeated `--map SOURCE=TARGET` options for explicit command mappings,
for example `--map labelstyle=mathsf` for the supported-subset example.

Omit the output path to print to stdout. For MathJax, load the generated script
before MathJax starts. It merges definitions into `MathJax.tex.macros`, preserving
unrelated macros and configuration settings. The output targets MathJax's
[configmacros format](https://docs.mathjax.org/en/latest/input/tex/extensions/configmacros.html);
operator definitions also require the AMS extension, included in the standard
`tex-mml-chtml` component.

For KaTeX, load the generated script before the renderer's first use. It imports
definitions using KaTeX's public `renderToString` API with `globalGroup`, then
adds them to the macro maps passed to `render` and `renderToString`. Existing
unrelated macros and other render options are preserved. The Quarto integration
handles script loading and subsequent `Quarto.typesetMath` calls automatically.
The implementation uses supported TeX definitions to preserve declared arity
and optional defaults, without depending on KaTeX's internal token API.
See [KaTeX options](https://katex.org/docs/options).

## supported declarations

The importer supports a declarative notation subset with three kinds of definition:

| Definition | Supported behavior | Declaration syntax |
| --- | --- | --- |
| Macro | Replacement text, up to nine arguments, optionally one leading default | Classic command declarations or the supported document-command signatures |
| Operator | Named math operator with ordinary or limits-style placement | `\DeclareMathOperator` and its starred form |
| Paired delimiter | Fixed, automatic, or explicit sizing, with parameterized contents | `\DeclarePairedDelimiter` and `\DeclarePairedDelimiterX` |

Create, replace, and fallback semantics are preserved. The syntax and semantics
below define the supported subset; sample preambles are integration fixtures.
See [example-contract.qmd](examples/example-contract.qmd) for an independent example
of the three definition kinds and an explicit user-defined alias.

Supported declarations are `\newcommand`, `\renewcommand`, `\providecommand`, and
`\DeclareMathOperator`, including starred forms, braced or unbraced names,
up to nine arguments, and an optional first-argument default. Comments, nested
groups, escaped delimiters, and `\endinput` are handled. Duplicate declarations,
invalid parameters, and malformed input produce source-location errors.
`\renewcommand` requires an earlier definition in the ordered inputs;
renewing a renderer built-in alone is not supported. A preceding
`\let\name\relax` (also with `=`) explicitly resets a name and permits its
replacement. Other `\let` assignments are rejected. `\providecommand` preserves
earlier imported definitions, renderer built-ins, and separately configured
renderer macros; otherwise it supplies a fallback. Stars on command definitions
are accepted, but TeX's paragraph restrictions are not enforced in math mode.

`\NewDocumentCommand`, `\RenewDocumentCommand`, and `\DeclareDocumentCommand`
also work with empty signatures, mandatory `m` arguments, or a single leading
`O{default}` followed by mandatory arguments. For example:

```latex
\NewDocumentCommand{\RR}{}{\mathbb{R}}
\NewDocumentCommand{\pair}{m m}{\langle #1,#2\rangle}
\NewDocumentCommand{\shift}{O{x} m}{#1+#2}
```

`NewDocumentCommand` rejects an already parsed definition; `RenewDocumentCommand`
requires one; `DeclareDocumentCommand` creates or replaces one, including across
files. The argument limit
is nine, including the optional argument. Signatures containing `s`, `o`, trailing
optional arguments, multiple defaults, or other xparse features are rejected
with a source-location error. These declaration forms take no declaration star.

`\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}` and
`\DeclarePairedDelimiterX{\set}[2]{\lbrace}{\rbrace}{#1\delimsize\vert#2}`
support ordinary calls, starred automatic sizing, and explicit sizing such as
`\abs[\Big]{x}`. Extended declarations accept zero to nine mandatory arguments.
Both engines support `\big`, `\Big`, `\bigg`, `\Bigg`, and an empty size option;
KaTeX requires these literal size selectors rather than custom size aliases.
Nested calls preserve their own sizes. MathJax uses its mathtools extension;
KaTeX receives equivalent TeX definitions.

`\NeedsTeXFormat{LaTeX2e}` and `\ProvidesPackage` are consumed as metadata.
Optional dates are recorded as metadata; they are not enforced as renderer
version requirements. `\RequirePackage` records dependencies without executing
LaTeX packages. Dependencies identified by explicitly supplied files are marked
as local. Nonempty options on these local dependencies are errors: their effects
cannot be reproduced without interpreting package option logic.

For external packages, the importer has descriptive notes for `amsmath`,
`amssymb`, `mathtools`, `xparse`, and `dsfont`. These notes do not gate conversion
or validate replacement bodies. Names without a supplied file or external note
produce an **unresolved package dependency** warning: they could be external
packages or missing local notation files. Unhandled external options are recorded
and warn that their effects are not reproduced. A missing explicitly supplied
file remains an error. Warnings include source locations and appear in Quarto's
log or the standalone converter's stderr, leaving JavaScript stdout usable.

This parser does not execute arbitrary TeX programs. Top-level conditionals,
`\def`, category-code changes, shell commands, and environment declarations are
outside the subset and produce syntax errors. The restricted relax reset described
above is supported explicitly. Metadata handling does not execute package code.

## renderer contract

Declaration parsing checks syntax, argument references, and declaration state.
It does **not** validate commands inside replacement bodies. A valid declaration
such as `\newcommand{\custom}{\unknownCommand{x}}` converts successfully and fails
only when the renderer encounters its unsupported command. This rule is the same
for `\mathds`, `\textsc`, and every other body command. There is no command-specific
compatibility checker or built-in substitution list.

MathJax uses a fixed profile: `base`, `ams`, `newcommand`, `configmacros`,
`boldsymbol`, and `mathtools`. The standard `tex-mml-chtml` component supplies the
baseline; generated configuration always adds the boldsymbol and mathtools loaders
and enables the complete profile. Existing unrelated loader entries, package
additions, and settings are preserved. Required profile packages remain enabled
even when an existing configuration attempted to remove them. This predictable
extension cost does not depend on package names or a scan of body-command names.

KaTeX uses its built-in mathematical vocabulary and generated macro definitions.
The renderer profiles do not imply identical command vocabularies or typography:
the selected renderer owns interpretation of replacement bodies and page math.
Use commands supported by both engines when portability is required and verify
representative expressions with each renderer. Renderer-specific commands may work in
one engine and fail in the other without being a declaration-parsing error.

Explicit YAML mappings and CLI `--map` entries are ordinary aliases selected by
the user. Their targets are not validated through a handwritten command catalog;
they undergo the same renderer checks as any other definition. Quarto can emit
HTML containing unsupported math because rendering happens in the browser.

