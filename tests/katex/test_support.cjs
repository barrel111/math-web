const katex = require('katex');
const converter = require('../converter_support.cjs');
const {root} = converter;

function generate(input, output) {
  return converter.generate('katex', input, output);
}

function load(input, extraContext = {}) {
  const {javascript, context} = converter.load('katex', input, extraContext);
  return {api: context.MathWebKatex, javascript, context};
}

function mathml(source, macros = {}, displayMode = false) {
  const markup = katex.renderToString(source, {
    macros,
    output: 'mathml',
    displayMode,
    throwOnError: true,
  });
  return markup.replace(/<annotation encoding="application\/x-tex">[\s\S]*?<\/annotation>/g, '');
}

module.exports = {root, katex, generate, load, mathml};
