const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {root} = require('./test_support.cjs');
const {workspace, write, render} = require('../support/quarto.cjs');
const {mathjax} = require('@mathjax/src/js/mathjax.js');
const {TeX} = require('@mathjax/src/js/input/tex.js');
const {liteAdaptor} = require('@mathjax/src/js/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler} = require('@mathjax/src/js/handlers/html.js');
require('@mathjax/src/js/input/tex/ams/AmsConfiguration.js');
require('@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js');
require('@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js');
RegisterHTMLHandler(liteAdaptor());

function document(directory, metadata = '', body = '$\\RR$') {
  write(directory, 'index.qmd', `---\ntitle: Integration test\n${metadata}\n---\n\n${body}\n`);
}
function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function configuration(html, expectLoader = true) {
  const scripts = [...html.matchAll(/<script id="math-web-macros">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'exactly one generated configuration');
  if (expectLoader) {
    const loader = html.search(/<script[^>]*src="[^"]*(?:mathjax|tex-mml)[^"]*"/i);
    assert.ok(loader > scripts[0].index, 'configuration must precede MathJax loading');
  }
  assert.equal(html.includes('src="mathjax-config.js"'), false);
  const context = vm.createContext({});
  // Include the test's user-supplied configuration, when present, in the actual
  // order it appears in the HTML before the external MathJax loader starts.
  for (const script of html.matchAll(/<script(?: id="(?:math-web-macros|user-mathjax)")?>([\s\S]*?)<\/script>/g)) {
    if (script[0].includes('id="math-web-macros"') || script[0].includes('id="user-mathjax"')) {
      vm.runInContext(script[1], context);
    }
  }
  return context.MathJax;
}
function compileMath(html, config) {
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros'],
    macros: config.tex.macros,
    formatError: (_jax, error) => { throw error; },
  });
  const doc = mathjax.document(html, {InputJax: tex});
  doc.findMath().compile();
  let count = 0;
  for (const item of doc.math) {
    assert.ok(item.root, 'each expression must compile');
    count++;
  }
  assert.ok(count > 0, 'Quarto output must contain discoverable math');
  return count;
}

test('custom format renders the declaration fixture and regenerates changed definitions', t => {
  const directory = workspace(t);
  const fixture = path.join(root, 'tests/fixtures/declarations');
  fs.copyFileSync(path.join(fixture, 'macros.sty'), path.join(directory, 'macros.sty'));
  const source = fs.readFileSync(path.join(fixture, 'index.qmd'), 'utf8')
    .replace('format: html', 'format: math-web-html\nmath-web:\n  macros: macros.sty');
  write(directory, 'index.qmd', source);
  success(render(directory));
  let html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  let config = configuration(html);
  assert.equal(config.tex.macros.choice, 'new');
  assert.equal(config.tex.macros.unused, 'u');
  assert.equal(Object.keys(config.tex.macros).length, 12);
  assert.equal(compileMath(html, config), 12);
  const style = path.join(directory, 'macros.sty');
  fs.writeFileSync(style, fs.readFileSync(style, 'utf8').replace('{new}', '{updated}'));
  success(render(directory));
  html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  config = configuration(html);
  assert.equal(config.tex.macros.choice, 'updated');
  assert.equal(compileMath(html, config), 12);
});

test('filter entry point works with ordinary HTML and preserves existing configuration', t => {
  const directory = workspace(t);
  write(directory, 'macros.sty', String.raw`\newcommand{\RR}{\mathbb{R}}`);
  document(directory, `format: html
filters: [math-web]
math-web:
  macros: macros.sty
include-in-header:
  text: |
    <script id="user-mathjax">globalThis.MathJax = {tex: {tags: 'ams', macros: {kept: 'k'}}};</script>`);
  success(render(directory));
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const config = configuration(html);
  assert.equal(config.tex.tags, 'ams');
  assert.equal(config.tex.macros.kept, 'k');
  assert.equal(config.tex.macros.RR, String.raw`\mathbb{R}`);
  compileMath(html, config);
});

test('project metadata resolves paths from the project root for nested documents', t => {
  const directory = workspace(t);
  write(directory, '_quarto.yml', `project:
  type: default
format: math-web-html
math-web:
  macros: "shared notation/macros.sty"
`);
  write(directory, 'shared notation/macros.sty', String.raw`\newcommand{\RR}{\mathbb{R}}`);
  write(directory, 'chapters/nested.qmd', '---\ntitle: Nested\n---\n\n$\\RR$\n');
  success(render(directory, {file: 'chapters/nested.qmd'}));
  const html = fs.readFileSync(path.join(directory, 'chapters/nested.html'), 'utf8');
  assert.equal(compileMath(html, configuration(html)), 1);
});

test('empty style input renders ordinary mathematics', t => {
  const directory = workspace(t);
  write(directory, 'empty.sty', '');
  document(directory, 'format: math-web-html\nmath-web:\n  macros: empty.sty', '$x+1$');
  success(render(directory));
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const config = configuration(html);
  assert.equal(Object.keys(config.tex.macros).length, 0);
  assert.equal(compileMath(html, config), 1);
});

test('missing input file fails with its path', t => {
  const directory = workspace(t);
  document(directory, 'format: math-web-html\nmath-web:\n  macros: absent.sty');
  const result = render(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /math-web:.*absent\.sty/);
});

test('malformed declarations fail with their original source location', t => {
  const directory = workspace(t);
  write(directory, 'broken.sty', '% first line\n\\newcommand{\\bad}{');
  document(directory, 'format: math-web-html\nmath-web:\n  macros: broken.sty');
  const result = render(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /broken\.sty:2:1:/);
});

for (const [name, setting] of [
  ['missing configuration', ''],
  ['empty list', 'math-web:\n  macros: []'],
  ['mapping', 'math-web:\n  macros: {file: one.sty}'],
  ['nested list', 'math-web:\n  macros: [[one.sty]]'],
  ['non-path list entry', 'math-web:\n  macros: [one.sty, true]'],
  ['empty list entry', 'math-web:\n  macros: [one.sty, ""]'],
  ['empty path', 'math-web:\n  macros: ""'],
]) {
  test(`invalid metadata: ${name}`, t => {
    const directory = workspace(t);
    document(directory, `format: math-web-html\n${setting}`);
    const result = render(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /math-web:.*math-web\.macros/);
  });
}

test('unsupported math backend fails explicitly', t => {
  const directory = workspace(t);
  write(directory, 'macros.sty', String.raw`\newcommand{\RR}{R}`);
  document(directory, 'format: html\nfilters: [math-web]\nhtml-math-method: mathml\nmath-web:\n  macros: macros.sty');
  const result = render(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /requires 'html-math-method: mathjax'/);
});

test('document-command fixture renders through MathJax', t => {
  const directory = workspace(t);
  const fixture = path.join(root, 'tests/fixtures/document-commands');
  fs.copyFileSync(path.join(fixture, 'macros.sty'), path.join(directory, 'macros.sty'));
  const source = fs.readFileSync(path.join(fixture, 'index.qmd'), 'utf8')
    .replace('format: html', 'format: math-web-html\nmath-web:\n  macros: macros.sty');
  write(directory, 'index.qmd', source);
  success(render(directory));
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  assert.equal(compileMath(html, configuration(html)), 9);
});

test('non-HTML output skips the converter', t => {
  const directory = workspace(t);
  document(directory, 'format: gfm\nfilters: [math-web]\nmath-web:\n  macros: absent.sty', 'Plain text.');
  success(render(directory));
  const output = fs.readFileSync(path.join(directory, 'index.md'), 'utf8');
  assert.ok(output.includes('Plain text.'));
  assert.equal(output.includes('math-web-macros'), false);
});

for (const inherited of [false, true]) {
  test(`multiple files with ${inherited ? 'project' : 'document'} metadata resolve nested paths`, t => {
    const directory = workspace(t);
    for (const file of ['base.sty', 'extra.sty']) {
      write(directory, `shared notation/${file}`,
        fs.readFileSync(path.join(root, 'tests/fixtures/multiple-files', file), 'utf8'));
    }
    const settings = `format: ${inherited ? 'math-web-html' : 'html'}
${inherited ? '' : 'filters: [math-web]\n'}math-web:
  macros:
    - "${inherited ? '' : '../'}shared notation/base.sty"
    - ${JSON.stringify(path.join(directory, 'shared notation/extra.sty'))}
`;
    write(directory, '_quarto.yml', 'project:\n  type: default\n' + (inherited ? settings : ''));
    write(directory, 'chapters/nested.qmd', `---\ntitle: Multiple files\n${inherited ? '' : settings}---\n
$\\domain + \\choice$\n\n$$\\pair{x}{y} + \\rankop(A)$$`);
    success(render(directory, {file: 'chapters/nested.qmd'}));
    const html = fs.readFileSync(path.join(directory, 'chapters/nested.html'), 'utf8');
    const config = configuration(html);
    assert.deepEqual(Object.keys(config.tex.macros).sort(),
      ['RR', 'choice', 'domain', 'pair', 'rankop', 'unusedBase', 'unusedExtra']);
    assert.equal(config.tex.macros.choice, 'new');
    assert.equal(config.tex.macros.domain, String.raw`\RR^2`);
    assert.equal(compileMath(html, config), 2);
  });
}

for (const backend of ['mathjax', 'katex']) {
  for (const [name, mutate, pattern] of [
    ['missing later file', directory => fs.unlinkSync(path.join(directory, 'extra.sty')), /extra\.sty/],
    ['cross-file duplicate', directory => write(directory, 'extra.sty', '\\newcommand{\\RR}{bad}'),
      /extra\.sty:1:1: duplicate definition.*base\.sty:1:1/],
    ['reversed files', () => {}, /extra\.sty:1:1: cannot renew undefined/],
  ]) {
    test(`${backend}: multiple-file ${name} aborts Quarto rendering`, t => {
      const directory = workspace(t);
      for (const file of ['base.sty', 'extra.sty']) {
        write(directory, file, fs.readFileSync(path.join(root, 'tests/fixtures/multiple-files', file), 'utf8'));
      }
      mutate(directory);
      const files = name === 'reversed files' ? '[extra.sty, base.sty]' : '[base.sty, extra.sty]';
      document(directory, `format: math-web-html\nhtml-math-method: ${backend}\nmath-web:\n  macros: ${files}`);
      const result = render(directory);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, pattern);
      assert.equal(fs.existsSync(path.join(directory, 'index.html')), false);
    });
  }
}
