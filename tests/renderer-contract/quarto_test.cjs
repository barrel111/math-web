const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {compiler} = require('../support/renderers.cjs');
const {workspace, copy, render} = require('../support/quarto.cjs');

for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: YAML rejects duplicate normalized mapping names`, t => {
    const directory = workspace(t);
    fs.writeFileSync(path.join(directory, 'macros.sty'), '');
    fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
math-web:
  macros: macros.sty
  mappings:
    foo: mathrm
    '\\foo': mathsf
---

$x$
`);
    const result = render(directory, {engine});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /duplicate mapping for command/);
    assert.equal(fs.existsSync(path.join(directory, 'index.html')), false);
  });
  test(`${engine}: the public subset example converts and compiles every expression`, t => {
    const directory = workspace(t);
    for (const name of ['example-contract.qmd', 'contract-macros.sty']) {
      copy(directory, path.join('examples', name));
    }
    const result = render(directory, {engine, file: 'example-contract.qmd'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const dom = new JSDOM(fs.readFileSync(path.join(directory, 'example-contract.html'), 'utf8'));
    t.after(() => dom.window.close());
    const script = dom.window.document.querySelector('#math-web-macros').textContent;
    const compile = compiler(engine, script);
    const expressions = [...dom.window.document.querySelectorAll('.math')];
    assert.equal(expressions.length, 5);
    for (const expression of expressions) {
      const source = engine === 'mathjax' ? expression.textContent.slice(2, -2) : expression.textContent;
      compile(source, expression.classList.contains('display'));
    }
    assert.equal(compile(String.raw`\vectorspace{V}`), compiler(engine)(String.raw`\mathsf{V}`));
    assert.equal(script.includes('unknownCommand'), false);
  });
}
