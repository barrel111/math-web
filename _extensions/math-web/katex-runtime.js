// Included inside the generated script's closure, with `preamble` supplied by
// katex.lua. The native engine and callers' macro maps are never modified.
function createMacros(engine, initialMacros = {}) {
  const macros = Object.assign({}, initialMacros);
  engine.renderToString(preamble, {macros, globalGroup: true, throwOnError: true});
  return macros;
}

function typeset(root, options = {}) {
  const elements = [
    ...(root.matches?.("span.math") ? [root] : []),
    ...root.querySelectorAll("span.math"),
  ].filter(element => !element.querySelector(".katex, .katex-error"));
  if (!elements.length) return;
  const engine = globalThis.katex;
  if (!engine) throw new Error("math-web: KaTeX has not been loaded");
  // Share state within this typesetting call, matching Quarto's math grouping.
  // A later call starts a fresh group; callers can retain createMacros() output
  // explicitly when they want a persistent scope for direct KaTeX API calls.
  const macros = createMacros(engine, options.macros);
  for (const element of elements) {
    engine.render(element.textContent, element, Object.assign({
      throwOnError: false, fleqn: false,
    }, options, {macros, displayMode: element.classList.contains("display")}));
  }
}

globalThis.MathWebKatex = {createMacros, typeset};
