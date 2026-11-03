const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mathjax} = require('@mathjax/src/js/mathjax.js');
const {TeX} = require('@mathjax/src/js/input/tex.js');
const {liteAdaptor} = require('@mathjax/src/js/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler} = require('@mathjax/src/js/handlers/html.js');
const {SerializedMmlVisitor} = require('@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js');
const {STATE} = require('@mathjax/src/js/core/MathItem.js');
require('@mathjax/src/js/input/tex/ams/AmsConfiguration.js');
require('@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js');
require('@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js');
const {load} = require('./test_support.cjs');
const path = require('node:path');
const cases = require('../render_cases.cjs');

RegisterHTMLHandler(liteAdaptor());
function compile(source, custom, display) {
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros'],
    macros: custom,
    formatError: (_jax, error) => { throw error; },
  });
  const document = mathjax.document('', {InputJax: tex});
  const node = document.convert(source, {display, end: STATE.COMPILED});
  // MathJax records the original source as data-latex metadata. Macro calls
  // and explicit expansions necessarily differ there, even with equal math.
  return new SerializedMmlVisitor().visitTree(node)
    .replace(/ data-latex(?:-item)?="[^"]*"/g, '');
}

// Compare MathJax's actual MathML trees against independently written TeX
// expansions. This checks argument substitution, operator classes, and limits,
// without relying on fonts, screenshots, or a browser's layout engine.
for (const [fixture, examples] of Object.entries(cases)) {
  const inputs = fixture === 'multiple-files'
    ? ['base.sty', 'extra.sty'].map(file => path.join(__dirname, '../fixtures', fixture, file))
    : path.join(__dirname, '../fixtures', fixture, 'macros.sty');
  const macros = load(inputs).config.tex.macros;
  for (const [name, invocation, expansion] of examples) {
    for (const display of [false, true]) {
      test(`${name}: ${display ? 'display' : 'inline'} MathML matches explicit expansion`, () => {
        assert.equal(compile(invocation, macros, display), compile(expansion, {}, display));
      });
    }
  }
}
