const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {root, fixture, generate, load} = require('./test_support.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web tests '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
function input(t, text) {
  const file = path.join(temporary(t), 'input.sty');
  fs.writeFileSync(file, text);
  return file;
}
test('generated JavaScript contains the complete macro configuration', () => {
  assert.equal(load().config.chtml, undefined);
  const macros = JSON.parse(JSON.stringify(load().config.tex.macros));
  assert.deepEqual(macros, {
    RR: String.raw`\mathbb{R}`,
    argmaxop: String.raw`\operatorname*{arg\,max}`,
    bare: 'b', choice: 'new', joined: 'a+b',
    literalBraces: [String.raw`\{#1\}`, 1],
    pair: [String.raw`\left\langle #1,\frac{#2}{2}\right\rangle`, 2],
    percent: String.raw`50\%`, rankop: String.raw`\operatorname{rank}`,
    spaced: ['\n  \\frac{#1}{2}\n', 1], unused: 'u',
    withDefault: ['#1+#2', 2, 'x'],
  });
});
test('preserves other MathJax settings and unrelated macros', () => {
  const existing = {loader: {load: ['[tex]/ams']}, chtml: {matchFontHeight: true, scale: 1.2}, tex: {tags: 'ams', macros: {kept: 'k', RR: 'old'}}};
  const {config} = load(fixture, existing);
  assert.equal(config, existing);
  assert.deepEqual(Array.from(config.loader.load), ['[tex]/ams', '[tex]/boldsymbol', '[tex]/mathtools']);
  assert.equal(config.chtml.matchFontHeight, true);
  assert.equal(config.chtml.scale, 1.2);
  assert.equal(config.tex.tags, 'ams');
  assert.equal(config.tex.macros.kept, 'k');
  assert.equal(config.tex.macros.RR, String.raw`\mathbb{R}`);
});
test('empty input creates an empty macro map', t => {
  assert.deepEqual(Object.keys(load(input(t, '')).config.tex.macros), []);
});
test('fixed profile is merged into explicit package arrays without duplicates', t => {
  const {config} = load(input(t, ''), {
    loader: {load: ['[tex]/color', '[tex]/mathtools']},
    tex: {packages: ['base', 'color', 'mathtools']},
  });
  assert.deepEqual(Array.from(config.loader.load), ['[tex]/color', '[tex]/mathtools', '[tex]/boldsymbol']);
  assert.deepEqual(Array.from(config.tex.packages), ['base', 'color', 'mathtools', 'ams', 'newcommand', 'configmacros', 'boldsymbol']);
});
test('fixed profile preserves unrelated package settings and restores required packages', t => {
  const {config} = load(input(t, ''), {
    tex: {packages: {'[+]': ['color', 'boldsymbol'], '[-]': ['autoload', 'mathtools', 'ams']}},
  });
  assert.deepEqual(Array.from(config.tex.packages['[+]']), ['color', 'boldsymbol', 'base', 'ams', 'newcommand', 'configmacros', 'mathtools']);
  assert.deepEqual(Array.from(config.tex.packages['[-]']), ['autoload']);
});
test('empty defaults are retained', t => {
  const {config} = load(input(t, String.raw`\newcommand{\optional}[1][]{#1}`));
  assert.deepEqual(Array.from(config.tex.macros.optional), ['#1', 1, '']);
});
test('JavaScript and inline-script escaping round-trips replacement text', t => {
  const body = '"</script>\\text{café}\t\n\u2028\u2029';
  const {config, javascript} = load(input(t, '\\newcommand{\\quoted}{' + body + '}'));
  assert.equal(config.tex.macros.quoted, body);
  assert.equal(javascript.toLowerCase().includes('</script'), false);
});
test('output is deterministic', () => {
  assert.equal(load().javascript, load().javascript);
});
test('CLI writes a file and resolves its modules outside the repository', t => {
  const directory = temporary(t);
  const destination = path.join(directory, 'configuration.js');
  const result = generate(fixture, destination, directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(destination, 'utf8'), load().javascript);
});
test('invalid input reports a source location and preserves existing output', t => {
  const destination = path.join(temporary(t), 'configuration.js');
  fs.writeFileSync(destination, 'existing configuration');
  const result = generate(path.join(root, 'tests/fixtures/declarations/invalid/unclosed.sty'), destination);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unclosed\.sty:1:1:/);
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'existing configuration');
});
test('missing input produces an error without JavaScript output', t => {
  const result = generate(path.join(temporary(t), 'missing.sty'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.sty/);
  assert.equal(result.stdout, '');
});
test('unwritable output path produces a nonzero exit', t => {
  const result = generate(fixture, path.join(temporary(t), 'absent', 'config.js'));
  assert.equal(result.status, 1);
  assert.notEqual(result.stderr, '');
});
