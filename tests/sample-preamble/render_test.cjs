const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {audit} = require('../support/preamble_audit.cjs');
const {compiler} = require('../support/renderers.cjs');
const cases = require('./cases.json');
const {fmapstoSource} = require('./preamble_support.cjs');
const inputs = ['core', 'prob', 'complexity', 'analysis', 'opt'].flatMap(name => ['--input', `tests/fixtures/sample-preamble/math-${name}.sty`]);
const mappings = ['--map', 'mathds=mathbf', '--map', 'textsc=mathrm'];
const inspected = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', ...inputs, ...mappings], {encoding: 'utf8'});
assert.equal(inspected.status, 0, inspected.stderr);
const report = JSON.parse(inspected.stdout);
assert.equal(report.complete, true);
assert.deepEqual(report.diagnostics, []);

for (const engine of ['mathjax', 'katex']) {
  for (const example of cases) {
    for (const display of [false, true]) {
      test(`${engine}: ${example.name}, ${display ? 'display' : 'inline'}`, () => {
        const expected = typeof example.expected === 'object' ? example.expected[engine] : example.expected;
        assert.equal(compiler(engine, report.javascript[engine])(example.tex, display), compiler(engine)(expected, display));
      });
    }
  }
}

function temporary(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web preamble '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'input.sty');
  fs.writeFileSync(file, source);
  return {directory, file};
}
test('audit reports unmapped fonts as renderer failures at their definition', () => {
  const result = audit([...inputs, '--map', 'textsc=mathrm', '--cases', 'tests/sample-preamble/cases.json']);
  assert.equal(result.complete, true);
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics, []);
  const failures = result.rendererChecks.filter(check => check.status === 'renderer failure');
  assert.equal(failures.length, 4);
  for (const failure of failures) {
    assert.equal(failure.command, '1');
    assert.equal(failure.source, 'tests/fixtures/sample-preamble/math-core.sty');
    assert.equal(failure.line, 35);
    assert.match(failure.message, /mathds/);
  }
});
test('audit tests supplied invocations without claiming untested mappings are covered', () => {
  const result = audit([...inputs, ...mappings, '--cases', 'tests/sample-preamble/cases.json']);
  assert.equal(result.ok, true);
  assert.equal(result.rendererChecks.length, cases.length * 4);
  assert.equal(result.declarations.find(item => item.name === 'mathds').rendererStatus, 'untested');
  assert.equal(result.declarations.filter(item => !item.mapped && item.rendererStatus === 'untested').length, 0);
  assert.equal(result.declarations.filter(item => !item.mapped).length, 73);
  assert.equal(result.declarations.find(item => item.name === 'textsc').rendererStatus, 'untested');
});
test('small caps are never silently substituted without the explicit mapping', () => {
  const result = audit([...inputs, '--map', 'mathds=mathbf', '--cases', 'tests/sample-preamble/cases.json']);
  assert.equal(result.ok, false);
  const failures = result.rendererChecks.filter(check => check.status === 'renderer failure');
  assert.equal(failures.length, 4);
  for (const failure of failures) {
    assert.equal(failure.command, 'opt');
    assert.equal(failure.source, 'tests/fixtures/sample-preamble/math-opt.sty');
    assert.match(failure.message, /textsc/);
  }
});
for (const [name, source, category] of [
  ['syntax', String.raw`\NewDocumentCommand{\f}{s m}{#2}`, 'unsupported syntax'],
  ['local package options', String.raw`\ProvidesPackage{local}\RequirePackage[option]{local}`, 'unsupported syntax'],
]) {
  test(`audit distinguishes ${name} blockers and reports an incomplete scan`, t => {
    const {file} = temporary(t, source);
    const result = audit(['--input', file]);
    assert.equal(result.complete, false);
    assert.equal(result.diagnostics[0].kind, category);
    assert.equal(result.diagnostics[0].source, file);
  });
}
test('audit reports renderer failures against the defining declaration', t => {
  const {directory, file} = temporary(t, String.raw`\newcommand{\bad}{\unknownCommand}`);
  const examples = path.join(directory, 'cases.json');
  fs.writeFileSync(examples, JSON.stringify([{name: 'bad macro', command: 'bad', tex: String.raw`\bad`}]));
  const result = audit(['--input', file, '--cases', examples]);
  assert.equal(result.ok, false);
  assert.equal(result.rendererChecks.length, 4);
  for (const check of result.rendererChecks) {
    assert.equal(check.status, 'renderer failure');
    assert.equal(check.source, file);
    assert.equal(check.line, 1);
  }
});
test('providecommand preserves built-ins and explicit resets replace them', t => {
  const {file} = temporary(t, String.raw`\providecommand{\frac}[2]{bad}
\providecommand{\fallback}[1][x]{#1}
\let\symbf\relax\providecommand{\symbf}[1]{\mathit{#1}}`);
  const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', '--input', file], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout);
  for (const engine of ['mathjax', 'katex']) {
    const compile = compiler(engine, inspected.javascript[engine]);
    const reference = compiler(engine);
    assert.equal(compile(String.raw`\frac{1}{2}`), reference(String.raw`\frac{1}{2}`));
    assert.equal(compile(String.raw`\fallback + \fallback[z]`), reference('x+z'));
    assert.equal(compile(String.raw`\symbf{x}`), reference(String.raw`\mathit{x}`));
  }
});

test('paired delimiters preserve zero and nine argument arities with all standard sizes', t => {
  const {file} = temporary(t, String.raw`\DeclarePairedDelimiterX{\zero}[0]{(}{)}{x}
\DeclarePairedDelimiterX{\nine}[9]{(}{)}{#9}`);
  const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', '--input', file], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout);
  for (const engine of ['mathjax', 'katex']) {
    const compile = compiler(engine, inspected.javascript[engine]);
    const reference = compiler(engine);
    assert.equal(compile(String.raw`\zero[]+y`), reference('(x)+y'));
    for (const size of ['big', 'Big', 'bigg', 'Bigg']) {
      const invocation = '\\nine[\\' + size + ']{a}{b}{c}{d}{e}{f}{g}{h}{i}+z';
      const expansion = '\\' + size + 'l(i\\' + size + 'r)+z';
      assert.equal(compile(invocation), reference(expansion));
    }
  }
});

test('provided fallbacks preserve separately configured renderer macros', t => {
  const {file} = temporary(t, String.raw`\providecommand{\fallback}{imported}`);
  const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', '--input', file], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout);
  const mathjaxScript = "globalThis.MathJax = {tex: {macros: {fallback: 'user'}}};\n" + inspected.javascript.mathjax;
  assert.equal(compiler('mathjax', mathjaxScript)(String.raw`\fallback`), compiler('mathjax')('user'));
  const vm = require('node:vm');
  const katex = require('katex');
  const context = vm.createContext({});
  vm.runInContext(inspected.javascript.katex, context);
  const engine = {...katex};
  const initial = {'\\fallback': 'user'};
  const options = {macros: context.MathWebKatex.createMacros(engine, initial), output: 'mathml'};
  assert.equal(engine.renderToString(String.raw`\fallback`, options), katex.renderToString(String.raw`\fallback`, options));
  assert.equal(options.macros['\\fallback'], 'user');
  assert.deepEqual(initial, {'\\fallback': 'user'});
});

test('converters preserve body commands and apply only explicit substitutions', t => {
  const {directory, file} = temporary(t, String.raw`\RequirePackage{dsfont}\newcommand{\1}{\mathds{1}}`);
  for (const engine of ['mathjax', 'katex']) {
    const output = path.join(directory, engine + '.js');
    const args = [`scripts/generate_${engine}.lua`, '--input', file, '--output', output];
    const converted = spawnSync(process.env.LUA || 'luajit', args, {encoding: 'utf8'});
    assert.equal(converted.status, 0, converted.stderr);
    assert.throws(() => compiler(engine, fs.readFileSync(output, 'utf8'))(String.raw`\1`), error => /mathds/.test(error.message));
    const accepted = spawnSync(process.env.LUA || 'luajit', [...args, '--map', 'mathds=mathbf'], {encoding: 'utf8'});
    assert.equal(accepted.status, 0, accepted.stderr);
    const compile = compiler(engine, fs.readFileSync(output, 'utf8'));
    assert.equal(compile(String.raw`\1`), compiler(engine)(String.raw`\mathbf{1}`));
  }
});

const arrowCases = [
  ['upper label', String.raw`x\fmapsto{f}y`, String.raw`x\xmapsto[]{\mkern8mu f\mkern8mu}y`],
  ['two labels', String.raw`x\fmapsto[b]{a}y`, String.raw`x\xmapsto[b]{\mkern8mu a\mkern8mu}y`],
  ['empty labels', String.raw`x\fmapsto[]{}y`, String.raw`x\xmapsto[]{\mkern8mu\mkern8mu}y`],
];
for (const engine of ['mathjax', 'katex']) for (const [name, invocation, expansion] of arrowCases) {
  for (const display of [false, true]) test(`${engine}: isolated padded arrow ${name}, ${display ? 'display' : 'inline'}`, t => {
    const {file} = temporary(t, fmapstoSource());
    const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', '--input', file], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const inspected = JSON.parse(result.stdout);
    assert.deepEqual(inspected.diagnostics, []);
    const compile = compiler(engine, inspected.javascript[engine]);
    const reference = compiler(engine);
    assert.equal(compile(invocation, display), reference(expansion, display));
    assert.equal(compile(String.raw`x\xmapsto[b]{a}y`, display), reference(String.raw`x\xmapsto[b]{a}y`, display));
  });
}
test('isolated arrow fixture matches the core fixture declaration', () => {
  const example = fs.readFileSync('tests/fixtures/sample-preamble/arrow.sty', 'utf8').replace(/^%[^\n]*\n/, '');
  assert.equal(example, fmapstoSource());
});
