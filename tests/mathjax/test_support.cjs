const path = require('node:path');
const converter = require('../converter_support.cjs');
const {root} = converter;
const fixture = path.join(root, 'tests/fixtures/declarations/macros.sty');

function generate(input = fixture, output, cwd = root) {
  return converter.generate('mathjax', input, output, cwd);
}

function load(input = fixture, existing) {
  const globals = existing ? {MathJax: existing} : {};
  const {javascript, context} = converter.load('mathjax', input, globals);
  return {config: context.MathJax, javascript};
}

module.exports = {root, fixture, generate, load};
