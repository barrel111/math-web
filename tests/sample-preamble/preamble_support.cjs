const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function fmapstoSource() {
  const source = fs.readFileSync(path.join(__dirname, '../fixtures/sample-preamble/math-core.sty'), 'utf8');
  const declaration = source.match(/\\NewDocumentCommand\{\\fmapsto\}\{O\{\} m\}\{[\s\S]*?\n\}/);
  assert.ok(declaration, 'the fixture fmapsto declaration must be present');
  return declaration[0] + '\n';
}

module.exports = {fmapstoSource};
