// Included inside the generated script's closure, with `preamble` supplied by
// katex.lua. Use documented TeX commands and public KaTeX APIs, not token internals.
const installedEngines = new WeakSet();

function createMacros(engine) {
  const macros = {};
  engine.renderToString(preamble, {macros, globalGroup: true, throwOnError: true});
  return macros;
}

function install(engine) {
  if (!engine || installedEngines.has(engine)) return;
  const importedMacros = createMacros(engine);
  const defaultMacros = Object.assign({}, importedMacros);
  const initializedMacroMaps = new WeakSet([defaultMacros]);
  const originalRender = engine.render;
  const originalRenderToString = engine.renderToString;

  function optionsWithMacros(options = {}) {
    const macros = options.macros || defaultMacros;
    if (!initializedMacroMaps.has(macros)) {
      // Import once per caller's macro map. Later global definitions retain
      // KaTeX's normal persistence semantics across expressions.
      for (const [name, definition] of Object.entries(importedMacros)) {
        if (!providedNames.has(name) || !Object.hasOwn(macros, name)) macros[name] = definition;
      }
      initializedMacroMaps.add(macros);
    }
    return Object.assign({}, options, {macros});
  }

  engine.render = function (source, element, options) {
    return originalRender.call(engine, source, element, optionsWithMacros(options));
  };
  engine.renderToString = function (source, options) {
    return originalRenderToString.call(engine, source, optionsWithMacros(options));
  };
  installedEngines.add(engine);
}

globalThis.MathWebKatex = {createMacros, install};
install(globalThis.katex);
if (typeof document !== "undefined") {
  // Quarto/Pandoc registers its initial render on DOMContentLoaded. This
  // header is earlier, and script-load capture also covers synchronous loaders.
  const initialize = () => install(globalThis.katex);
  document.addEventListener("load", initialize, true);
  document.addEventListener("DOMContentLoaded", initialize, {once: true});
}
