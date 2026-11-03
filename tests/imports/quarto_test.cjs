const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {compiler} = require('../support/renderers.cjs');
const {workspace: createWorkspace, render} = require('../support/quarto.cjs');

const allNames = ['future', 'mathopen', 'pair', 'styled', 'unused'];

function workspace(t, engine, body, setting = '') {
  const directory = createWorkspace(t);
  fs.writeFileSync(path.join(directory, 'macros.sty'), String.raw`\newcommand{\mathopen}[1]{#1+x}
\DeclarePairedDelimiter{\pair}{(}{)}
\newcommand{\future}{\mathbb{F}}
\newcommand{\unused}{u}
`);
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
html-math-method: ${engine}
math-web:
  macros: macros.sty
  mappings:
    styled: mathsf
${setting}---

${body}
`);
  return directory;
}

function configuration(directory, engine) {
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const script = html.match(/<script id="math-web-macros">([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({});
  vm.runInContext(script, context);
  const names = engine === 'mathjax'
    ? [...Object.keys(context.MathJax.tex.macros), ...Object.keys(context.MathJax.tex.mathtools.pairedDelimiters)]
    : Object.keys(context.MathWebKatex.createMacros(require('katex')))
      .map(name => name.slice(1)).filter(name => !name.startsWith('mathweb@'));
  assert.deepEqual(names.sort(), allNames);
  return script;
}

for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: all imports remain available, including generated renderer dependencies`, t => {
    const directory = workspace(t, engine, String.raw`$$\pair*{y}$$`);
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const compile = compiler(engine, configuration(directory, engine));
    const reference = compiler(engine);
    assert.equal(compile(String.raw`\pair*{y}`), reference(String.raw`\left(y\right)+x\mathclose{}`));
    assert.equal(compile(String.raw`\future`), reference(String.raw`\mathbb{F}`));
    assert.equal(compile(String.raw`\unused`), reference('u'));
    assert.equal(compile(String.raw`\styled{V}`), reference(String.raw`\mathsf{V}`));
  });

  test(`${engine}: a page without math still emits all imports`, t => {
    const directory = workspace(t, engine, 'Plain text.');
    const result = render(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    configuration(directory, engine);
  });

  for (const setting of ['filter: false', 'include: [future]']) {
    test(`${engine}: removed setting ${setting} fails with migration guidance`, t => {
      const directory = workspace(t, engine, '$x$', `  ${setting}\n`);
      const result = render(directory);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /has been removed; delete this setting; all imported definitions are always available/);
      assert.equal(fs.existsSync(path.join(directory, 'index.html')), false);
    });
  }
}
