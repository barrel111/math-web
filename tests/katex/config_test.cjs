const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {katex, generate, load, mathml, root} = require('./test_support.cjs');
const fixture = path.join(root, 'tests/fixtures/declarations/macros.sty');
function temporary(t, source = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web katex '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const input = path.join(directory, 'macros.sty');
  fs.writeFileSync(input, source);
  return {directory, input};
}
test('configuration imports unused definitions and optional helpers', () => {
  const macros = load(fixture).api.createMacros(katex);
  assert.ok(Object.hasOwn(macros, '\\unused'));
  assert.equal(mathml('\\unused', macros), mathml('u'));
});
test('empty input generates an empty macro map', t => {
  const {input} = temporary(t);
  assert.deepEqual(Object.keys(load(input).api.createMacros(katex)), []);
});
test('unused optional and mandatory arguments are consumed', t => {
  const {input} = temporary(t, String.raw`\NewDocumentCommand{\f}{O{x} m m}{#2}`);
  const macros = load(input).api.createMacros(katex);
  assert.equal(mathml(String.raw`\f{y}{ignored}+z`, macros), mathml('y+z'));
  assert.equal(mathml(String.raw`\f[ignored]{y}{ignored}+z`, macros), mathml('y+z'));
});
test('optional-only macros and bracket-containing defaults', t => {
  const {input} = temporary(t, String.raw`\NewDocumentCommand{\f}{O{a]b}}{#1}`);
  const macros = load(input).api.createMacros(katex);
  assert.equal(mathml('\\f', macros), mathml('a]b'));
  assert.equal(mathml('\\f[]', macros), mathml(''));
  assert.equal(mathml('\\f[{x]y}]', macros), mathml('x]y'));
});
test('script escaping protects embedded replacement strings', t => {
  const {input} = temporary(t, String.raw`\newcommand{\f}{\text{</script>}}`);
  const {api, javascript} = load(input);
  assert.equal(javascript.toLowerCase().includes('</script'), false);
  assert.equal(mathml('\\f', api.createMacros(katex)), mathml(String.raw`\text{</script>}`));
});
test('macro scopes preserve caller maps and native APIs while supporting global definitions', () => {
  const engine = {...katex};
  const originalRender = engine.render, originalRenderToString = engine.renderToString;
  const {api} = load(fixture, {katex: engine});
  const initial = Object.freeze({[String.raw`\kept`]: 'k'});
  const macros = api.createMacros(engine, initial);
  assert.equal(engine.render, originalRender);
  assert.equal(engine.renderToString, originalRenderToString);
  assert.deepEqual(initial, {[String.raw`\kept`]: 'k'});
  assert.notEqual(macros, initial);
  assert.equal(mathml(String.raw`\RR+\kept`, macros), mathml(String.raw`\mathbb{R}+k`));
  engine.renderToString(String.raw`\gdef\choice{changed}`, {macros});
  assert.equal(mathml(String.raw`\choice`, macros), mathml('changed'));
  assert.equal(mathml(String.raw`\choice`, api.createMacros(engine, initial)), mathml('new'));
});
test('typesetter supplies options only to math spans without changing native engine methods', t => {
  const {JSDOM} = require('jsdom');
  const dom = new JSDOM(String.raw`<!doctype html><div><span class="math display">\RR+\kept</span><span id="other">plain</span></div>`);
  t.after(() => dom.window.close());
  const received = [];
  const engine = {...katex, render: (source, element, options) => received.push({source, element, options})};
  const originalRender = engine.render, originalRenderToString = engine.renderToString;
  const {api} = load(fixture, {katex: engine});
  const macros = Object.freeze({[String.raw`\kept`]: 'k'});
  const options = {macros, output: 'mathml', throwOnError: true};
  api.typeset(dom.window.document, options);
  assert.equal(received.length, 1);
  assert.equal(received[0].element.className, 'math display');
  assert.equal(received[0].options.displayMode, true);
  assert.equal(received[0].options.throwOnError, true);
  assert.equal(mathml(received[0].source, received[0].options.macros), mathml(String.raw`\mathbb{R}+k`));
  assert.equal(options.macros, macros);
  assert.deepEqual(macros, {[String.raw`\kept`]: 'k'});
  assert.equal(engine.render, originalRender);
  assert.equal(engine.renderToString, originalRenderToString);
});
test('typesetting shares global definitions within a call and skips rendered nodes on later calls', t => {
  const {JSDOM} = require('jsdom');
  const dom = new JSDOM(String.raw`<!doctype html><div id="first"><span class="math">\gdef\choice{changed}</span><span class="math">\choice</span></div>`, {runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const {window} = dom;
  window.eval(fs.readFileSync(require.resolve('katex'), 'utf8'));
  const originalRender = window.katex.render, originalRenderToString = window.katex.renderToString;
  window.eval(load(fixture).javascript);
  const first = window.document.querySelector('#first');
  window.MathWebKatex.typeset(first);
  const expected = window.document.createElement('div');
  expected.innerHTML = mathml('changed');
  const withoutSource = element => element.querySelector('math').outerHTML.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
  assert.equal(withoutSource(first.lastElementChild), expected.querySelector('math').outerHTML);
  const previous = first.innerHTML;
  window.MathWebKatex.typeset(first);
  assert.equal(first.innerHTML, previous);
  const later = window.document.createElement('span');
  later.className = 'math'; later.textContent = String.raw`\choice`;
  window.MathWebKatex.typeset(later);
  expected.innerHTML = mathml('new');
  assert.equal(withoutSource(later), expected.querySelector('math').outerHTML);
  assert.equal(window.katex.render, originalRender);
  assert.equal(window.katex.renderToString, originalRenderToString);
});
test('CLI output is deterministic and invalid input preserves destination', t => {
  const {directory, input} = temporary(t, String.raw`\newcommand{\f}{x}`);
  const output = path.join(directory, 'config.js');
  const result = generate(input, output);
  assert.equal(result.status, 0, result.stderr);
  const original = fs.readFileSync(output, 'utf8');
  assert.equal(original, generate(input).stdout);
  fs.writeFileSync(input, String.raw`\newcommand{\f}{`);
  const failed = generate(input, output);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /macros\.sty:1:1:/);
  assert.equal(fs.readFileSync(output, 'utf8'), original);
});
