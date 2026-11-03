const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {katex, root} = require('./test_support.cjs');
const {workspace, renderHtml} = require('../support/quarto.cjs');
const browserKaTeX = fs.readFileSync(require.resolve('katex'), 'utf8');
const pinnedBase = `https://cdn.jsdelivr.net/npm/katex@${require('../package.json').devDependencies.katex}/dist/`;

// Execute the actual math-related scripts from Quarto's HTML in document order.
// External resources are disabled; the pinned local KaTeX replaces the CDN
// script. Other Quarto UI scripts are outside the scope of the math integration.
async function execute(t, html, assetBase = pinnedBase) {
  const dom = new JSDOM(html, {runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const {window} = dom;
  const expressions = [...window.document.querySelectorAll('.math')]
    .map(element => ({element, source: element.textContent, displayMode: element.classList.contains('display')}));
  const scripts = [...window.document.querySelectorAll('script')];
  const config = scripts.findIndex(script => script.id === 'math-web-macros');
  const isKatexScript = script => /\/katex(?:\.min)?\.js$/.test(script.src);
  const resourceScripts = scripts.filter(isKatexScript);
  assert.ok(config >= 0);
  if (expressions.length) {
    assert.equal(resourceScripts.length, 1, 'one KaTeX loader');
    assert.ok(scripts.indexOf(resourceScripts[0]) > config, 'configuration precedes KaTeX loader');
    assert.equal(resourceScripts[0].src, assetBase + 'katex.min.js');
    const styles = [...window.document.querySelectorAll('link[href$="katex.min.css"]')];
    assert.equal(styles.length, 1, 'one KaTeX stylesheet');
    assert.equal(styles[0].href, assetBase + 'katex.min.css');
  }
  let originalRender, originalRenderToString;
  for (const script of scripts) {
    if (isKatexScript(script)) {
      window.eval(browserKaTeX);
      originalRender = window.katex.render;
      originalRenderToString = window.katex.renderToString;
      script.dispatchEvent(new window.Event('load'));
    } else if (script.id.startsWith('math-web-') || script.textContent.includes('katex.render(')) {
      window.eval(script.textContent);
    }
  }
  await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, {once: true}));
  assert.equal(window.Quarto.typesetMath, window.MathWebKatex.typeset);
  if (expressions.length) {
    assert.equal(window.katex.render, originalRender);
    assert.equal(window.katex.renderToString, originalRenderToString);
    const macros = window.MathWebKatex.createMacros(katex);
    for (const {element, source, displayMode} of expressions) {
      const expected = window.document.createElement('div');
      expected.innerHTML = katex.renderToString(source, {macros, displayMode, output: 'mathml', throwOnError: true});
      assert.ok(element.querySelector('.katex'), 'initial Quarto renderer ran');
      assert.equal(element.querySelector('math')?.outerHTML, expected.querySelector('math').outerHTML);
    }
  }
  return {window, expressions};
}

for (const [fixture, customFormat, count] of [
  ['declarations', false, 12],
  ['document-commands', true, 9],
  ['multiple-files', false, 4],
]) {
  test(`${fixture}: actual Quarto initial and dynamic rendering uses imported macros`, async t => {
    const directory = workspace(t);
    const inputs = path.join(root, 'tests/fixtures', fixture);
    const files = fixture === 'multiple-files' ? ['base.sty', 'extra.sty'] : ['macros.sty'];
    for (const file of files) fs.copyFileSync(path.join(inputs, file), path.join(directory, file));
    let source = fs.readFileSync(path.join(inputs, 'index.qmd'), 'utf8')
      .replace(/^html-math-method:.*\n/m, '')
      .replace('format: html', `format: ${customFormat ? 'math-web-html' : 'html'}
${customFormat ? '' : 'filters: [math-web]\n'}html-math-method: katex
math-web:
  macros: ${JSON.stringify(files)}`);
    fs.writeFileSync(path.join(directory, 'index.qmd'), source);
    const {window, expressions} = await execute(t, renderHtml(directory));
    assert.equal(expressions.length, count);
    const container = window.document.createElement('div');
    const span = window.document.createElement('span');
    span.className = 'math inline';
    const invocation = fixture === 'declarations' ? String.raw`\withDefault{y}`
      : fixture === 'multiple-files' ? String.raw`\domain + \choice` : String.raw`\shift{y}`;
    span.textContent = invocation;
    container.appendChild(span);
    window.Quarto.typesetMath(container);
    assert.ok(span.querySelector('.katex'));
    const expected = window.document.createElement('div');
    expected.innerHTML = katex.renderToString(invocation, {
      macros: window.MathWebKatex.createMacros(katex), output: 'mathml', throwOnError: true,
    });
    assert.equal(span.querySelector('math').outerHTML, expected.querySelector('math').outerHTML);
  });
}

test('custom KaTeX asset directories are preserved and native API calls stay independent', async t => {
  const directory = workspace(t);
  const assetBase = 'https://assets.example.test/math/';
  fs.writeFileSync(path.join(directory, 'macros.sty'), String.raw`\newcommand{\documentOnly}{x}`);
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: html
filters: [math-web]
html-math-method:
  method: katex
  url: ${assetBase}
math-web:
  macros: macros.sty
---

$\\documentOnly$
`);
  const {window} = await execute(t, renderHtml(directory), assetBase);
  assert.ok(window.document.querySelector('.math .katex'));
  assert.throws(() => window.katex.renderToString(String.raw`\documentOnly`, {throwOnError: true}), /Undefined control sequence/);
  const target = window.document.createElement('div');
  const callerMacros = Object.freeze({[String.raw`\external`]: 'z'});
  window.katex.render(String.raw`\external`, target, {macros: callerMacros, throwOnError: true});
  assert.ok(target.querySelector('math'));
  assert.deepEqual(callerMacros, {[String.raw`\external`]: 'z'});
});

test('KaTeX project configuration works for nested documents', async t => {
  const directory = workspace(t);
  fs.mkdirSync(path.join(directory, 'chapters'));
  fs.writeFileSync(path.join(directory, '_quarto.yml'), `project:
  type: default
format: math-web-html
html-math-method: katex
math-web:
  macros: macros.sty
`);
  fs.writeFileSync(path.join(directory, 'macros.sty'), String.raw`\NewDocumentCommand{\DocRR}{}{\mathbb{R}}`);
  fs.writeFileSync(path.join(directory, 'chapters/nested.qmd'), '---\ntitle: Nested\n---\n\n$\\DocRR$');
  const {expressions} = await execute(t, renderHtml(directory, {file: 'chapters/nested.qmd'}));
  assert.equal(expressions.length, 1);
});

test('empty style file supports ordinary KaTeX mathematics', async t => {
  const directory = workspace(t);
  fs.writeFileSync(path.join(directory, 'macros.sty'), '');
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
title: Empty style
format: math-web-html
html-math-method: katex
math-web:
  macros: macros.sty
---

$x+1$
`);
  const {expressions} = await execute(t, renderHtml(directory));
  assert.equal(expressions.length, 1);
});

test('document without mathematics does not require a loaded KaTeX engine', async t => {
  const directory = workspace(t);
  fs.writeFileSync(path.join(directory, 'macros.sty'), String.raw`\newcommand{\RR}{\mathbb{R}}`);
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
title: No math
format: math-web-html
html-math-method: katex
math-web:
  macros: macros.sty
---

Plain text.
`);
  const {window, expressions} = await execute(t, renderHtml(directory));
  assert.equal(expressions.length, 0);
  assert.equal(window.katex, undefined);
});

test('KaTeX inherits multiple paths from project metadata for nested documents', async t => {
  const directory = workspace(t);
  fs.mkdirSync(path.join(directory, 'chapters'));
  fs.mkdirSync(path.join(directory, 'shared notation'));
  for (const file of ['base.sty', 'extra.sty']) {
    fs.copyFileSync(path.join(root, 'tests/fixtures/multiple-files', file), path.join(directory, 'shared notation', file));
  }
  fs.writeFileSync(path.join(directory, '_quarto.yml'), `project:
  type: default
format: math-web-html
html-math-method: katex
math-web:
  macros:
    - "shared notation/base.sty"
    - "shared notation/extra.sty"
`);
  fs.writeFileSync(path.join(directory, 'chapters/nested.qmd'), '---\ntitle: Nested\n---\n\n$\\domain + \\choice$');
  const {window, expressions} = await execute(t, renderHtml(directory, {file: 'chapters/nested.qmd'}));
  assert.equal(expressions.length, 1);
  const expected = window.document.createElement('div');
  expected.innerHTML = katex.renderToString(String.raw`\mathbb{R}^2 + new`, {output: 'mathml'});
  const actual = expressions[0].element.querySelector('math').cloneNode(true);
  actual.querySelector('annotation').remove();
  expected.querySelector('annotation').remove();
  assert.equal(actual.outerHTML, expected.querySelector('math').outerHTML);
});

test('all imported macros work in subsequent Quarto.typesetMath calls', async t => {
  const directory = workspace(t);
  fs.writeFileSync(path.join(directory, 'macros.sty'), String.raw`\newcommand{\RR}{\mathbb{R}}
\newcommand{\future}{\RR^2}
\newcommand{\unused}{u}`);
  fs.writeFileSync(path.join(directory, 'index.qmd'), `---
title: Dynamic math
format: math-web-html
html-math-method: katex
math-web:
  macros: macros.sty
---

$x$
`);
  const {window} = await execute(t, renderHtml(directory));
  assert.deepEqual(Object.keys(window.MathWebKatex.createMacros(katex)).sort(), ['\\RR', '\\future', '\\unused']);
  const container = window.document.createElement('div');
  container.innerHTML = '<span class="math inline">\\future</span>';
  window.Quarto.typesetMath(container);
  const actual = container.querySelector('math');
  assert.ok(actual);
  actual.querySelector('annotation').remove();
  const expected = window.document.createElement('div');
  expected.innerHTML = katex.renderToString(String.raw`\mathbb{R}^2`, {output: 'mathml'});
  expected.querySelector('annotation').remove();
  assert.equal(actual.outerHTML, expected.querySelector('math').outerHTML);
});
