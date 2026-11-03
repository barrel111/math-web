const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {compiler} = require('../support/renderers.cjs');
const {workspace: createWorkspace, render, copy} = require('../support/quarto.cjs');

function workspace(t, engine) {
  const directory = createWorkspace(t);
  for (const name of ['math-core', 'math-complexity']) {
    copy(directory, `tests/fixtures/sample-preamble/${name}.sty`);
  }
  fs.writeFileSync(path.join(directory, 'extra.sty'), String.raw`\RequirePackage[mode]{unknown}`);
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
html-math-method: ${engine}
math-web:
  macros: [math-core.sty, math-complexity.sty, extra.sty]
---

$\\OO{n}$
`);
  return directory;
}
function generated(directory) {
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  return html.match(/<script id="math-web-macros">([\s\S]*?)<\/script>/)[1];
}

for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: supplied complexity dependency renders while unresolved external options warn`, t => {
    const directory = workspace(t, engine);
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /extra\.sty:1:1: unresolved package dependency/);
    assert.match(result.stdout + result.stderr, /unhandled package options/);
    const script = generated(directory);
    assert.equal(compiler(engine, script)(String.raw`\OO{n}`),
      compiler(engine)(String.raw`\mathcal{O}\mathopen{\left(n\right)}\mathclose{}`));
    assert.equal(script.includes('mathds'), true);
    const file = path.join(directory, 'index.qmd');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\\OO{n}', '\\class{P}'));
    const second = render(directory);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const rerendered = generated(directory);
    assert.equal(compiler(engine, rerendered)(String.raw`\class{P}`), compiler(engine)(String.raw`\mathsf{P}`));
    if (engine === 'mathjax') {
      const context = vm.createContext({});
      vm.runInContext(rerendered, context);
      assert.deepEqual(Array.from(context.MathJax.loader.load), ['[tex]/boldsymbol', '[tex]/mathtools']);
      assert.ok(context.MathJax.tex.macros.class);
      assert.ok(context.MathJax.tex.macros['1'], 'other imported commands stay available');
    }
  });
  test(`${engine}: local package options stop Quarto before HTML is emitted`, t => {
    const directory = workspace(t, engine);
    fs.writeFileSync(path.join(directory, 'extra.sty'), String.raw`\RequirePackage[mode]{math-core}`);
    const result = render(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /options for supplied local package 'math-core'/);
    assert.equal(fs.existsSync(path.join(directory, 'index.html')), false);
  });
}
