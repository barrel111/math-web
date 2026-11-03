const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const {compiler} = require('../support/renderers.cjs');
const {workspace: createWorkspace, render, copy, root} = require('../support/quarto.cjs');
const katexBundle = fs.readFileSync(require.resolve('katex'), 'utf8');
const allNames = [...new Set(require('./cases.json').map(item => item.command)), 'mathds', 'textsc'].sort();

function workspace(t, engine, mapping = true) {
  const directory = createWorkspace(t);
  copy(directory, 'tests/fixtures/sample-preamble', '.');
  let source = fs.readFileSync(path.join(root, 'tests/fixtures/sample-preamble/index.qmd'), 'utf8');
  source = source.replace('format: math-web-html', `format: math-web-html\nhtml-math-method: ${engine}`);
  if (!mapping) source = source.replace('    mathds: mathbf\n', '');
  fs.writeFileSync(path.join(directory, 'index.qmd'), source);
  return directory;
}
for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: notation fixtures render with all imported definitions`, async t => {
    const directory = workspace(t, engine);
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const dom = new JSDOM(html, {runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    const {window} = dom;
    const script = window.document.querySelector('#math-web-macros');
    const compile = compiler(engine, script.textContent);
    const expressions = [...window.document.querySelectorAll('.math')];
    assert.equal(expressions.length, 12);
    for (const expression of expressions) {
      const tex = engine === 'mathjax' ? expression.textContent.slice(2, -2) : expression.textContent;
      compile(tex, true);
    }
    const context = vm.createContext({});
    vm.runInContext(script.textContent, context);
    if (engine === 'mathjax') {
      const names = [...Object.keys(context.MathJax.tex.macros), ...Object.keys(context.MathJax.tex.mathtools.pairedDelimiters), 'Empty', 'symbf'].sort();
      assert.deepEqual(names, allNames);
      assert.deepEqual(Array.from(context.MathJax.loader.load).sort(), ['[tex]/boldsymbol', '[tex]/mathtools']);
    } else {
      const katex = require('katex');
      const macros = context.MathWebKatex.createMacros(katex);
      assert.deepEqual(Object.keys(macros).map(name => name.slice(1)).filter(name => !name.startsWith('mathweb@')).sort(), allNames);
      for (const element of window.document.querySelectorAll('script')) {
        if (/\/katex[^/]*\/dist\/katex(?:\.min)?\.js/.test(element.src)) {
          window.eval(katexBundle);
          element.dispatchEvent(new window.Event('load'));
        } else if (element.id.startsWith('math-web-') || element.textContent.includes('katex.render(')) {
          window.eval(element.textContent);
        }
      }
      await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, {once: true}));
      assert.equal(window.document.querySelectorAll('.katex').length, 12);
      assert.equal(window.document.querySelectorAll('.katex-error').length, 0);
      const container = window.document.createElement('div');
      container.innerHTML = '<span class="math inline">\\set[\\Big]{x}{x\\in\\R}</span>';
      window.Quarto.typesetMath(container);
      assert.ok(container.querySelector('math'));
      const actual = container.querySelector('.katex').outerHTML.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
      assert.ok(actual.includes('minsize="1.8em"'));
    }
    for (const file of ['math-core.sty', 'math-prob.sty', 'math-analysis.sty', 'math-opt.sty', 'math-complexity.sty']) {
      assert.equal(fs.readFileSync(path.join(directory, file), 'utf8'), fs.readFileSync(path.join(root, 'tests/fixtures/sample-preamble', file), 'utf8'));
    }
  });
  test(`${engine}: unknown body commands reach the renderer without blocking Quarto`, t => {
    const directory = workspace(t, engine, false);
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const script = html.match(/<script id="math-web-macros">([\s\S]*?)<\/script>/)[1];
    assert.throws(() => compiler(engine, script)(String.raw`\1`), error => /mathds/.test(error.message));
  });
  test(`${engine}: unused font command does not require a mapping`, t => {
    const directory = workspace(t, engine, false);
    const source = fs.readFileSync(path.join(directory, 'index.qmd'), 'utf8');
    fs.writeFileSync(path.join(directory, 'index.qmd'), source.slice(0, source.indexOf('\n---', 4) + 4) + '\n\n$\\parens{x}$');
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const script = html.match(/<script id="math-web-macros">([\s\S]*?)<\/script>/)[1];
    assert.equal(script.includes('mathds'), true);
    compiler(engine, script)(String.raw`\parens{x}`);
  });
  test(`${engine}: padded arrow alone works under the renderer profile`, t => {
    const directory = workspace(t, engine);
    fs.writeFileSync(path.join(directory, 'index.qmd'), `---\nformat: math-web-html\nhtml-math-method: ${engine}\nmath-web:\n  macros: math-core.sty\n---\n\n$x\\fmapsto[b]{a}y$\n`);
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const script = html.match(/<script id="math-web-macros">([\s\S]*?)<\/script>/)[1];
    assert.equal(compiler(engine, script)(String.raw`x\fmapsto[b]{a}y`),
      compiler(engine)(String.raw`x\xmapsto[b]{\mkern8mu a\mkern8mu}y`));
    if (engine === 'mathjax') {
      const context = vm.createContext({});
      vm.runInContext(script, context);
      assert.ok(context.MathJax.tex.macros.fmapsto);
      assert.ok(context.MathJax.tex.macros['1'], 'other imported commands stay available');
      assert.deepEqual(Array.from(context.MathJax.loader.load), ['[tex]/boldsymbol', '[tex]/mathtools']);
    }
  });
}
