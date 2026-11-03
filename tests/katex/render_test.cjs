const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cases = require('../render_cases.cjs');
const {katex, load, mathml} = require('./test_support.cjs');

for (const [fixture, examples] of Object.entries(cases)) {
  const inputs = fixture === 'multiple-files'
    ? ['base.sty', 'extra.sty'].map(file => path.join(__dirname, '../fixtures', fixture, file))
    : path.join(__dirname, '../fixtures', fixture, 'macros.sty');
  const {api} = load(inputs);
  for (const [name, invocation, expansion] of examples) {
    for (const display of [false, true]) {
      test(`${name}: ${display ? 'display' : 'inline'} MathML matches explicit expansion`, () => {
        assert.equal(mathml(invocation, api.createMacros(katex), display), mathml(expansion, {}, display));
      });
    }
  }
}
