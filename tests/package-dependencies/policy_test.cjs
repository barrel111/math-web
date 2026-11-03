const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {audit} = require('../support/preamble_audit.cjs');
const {compiler} = require('../support/renderers.cjs');

function files(t, sources) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web packages '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return Object.entries(sources).map(([name, source]) => {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, source);
    return file;
  });
}
const argumentsFor = paths => paths.flatMap(file => ['--input', file]);
function inspect(paths) {
  const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', ...argumentsFor(paths)], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('supplied filenames and declared package names resolve without reimporting definitions', t => {
  const paths = files(t, {
    'base.sty': String.raw`\ProvidesPackage{notation}\newcommand{\leaf}{x}`,
    'main.sty': String.raw`\RequirePackage{notation,base,notation}\newcommand{\parent}{\leaf}`,
  });
  const report = inspect(paths);
  assert.equal(report.complete, true);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(Object.keys(report.definitions).sort(), ['leaf', 'parent']);
  for (const dependency of report.packages) {
    assert.equal(dependency.status, 'supplied local dependency');
    assert.equal(dependency.resolvedSource, paths[0]);
  }
});

test('later supplied packages are recognized but explicit declaration order is preserved', t => {
  const paths = files(t, {
    'main.sty': String.raw`\RequirePackage{base}\newcommand{\parent}{\leaf}`,
    'base.sty': String.raw`\newcommand{\leaf}{x}`,
  });
  assert.equal(inspect(paths).packages[0].resolvedSource, paths[1]);
  fs.writeFileSync(paths[0], String.raw`\RequirePackage{base}\renewcommand{\leaf}{y}`);
  const report = inspect(paths);
  assert.equal(report.complete, false);
  assert.match(report.diagnostics[0].message, /cannot renew undefined/);
});

test('local options fail even when the supplied package is declared later', t => {
  const paths = files(t, {
    'main.sty': '\\RequirePackage[mode]{notation}\n',
    'base.sty': String.raw`\ProvidesPackage{notation}\newcommand{\leaf}{x}`,
  });
  const report = inspect(paths);
  assert.equal(report.complete, false);
  assert.equal(report.diagnostics[0].kind, 'unsupported syntax');
  assert.equal(report.diagnostics[0].source, paths[0]);
  assert.equal(report.diagnostics[0].line, 1);
  assert.match(report.diagnostics[0].message, /options for supplied local package/);
});

test('ambiguous supplied package identities fail instead of selecting a file', t => {
  const paths = files(t, {
    'main.sty': String.raw`\RequirePackage{base}`,
    'first/base.sty': String.raw`\newcommand{\one}{1}`,
    'second/base.sty': String.raw`\newcommand{\two}{2}`,
  });
  const report = inspect(paths);
  assert.equal(report.complete, false);
  assert.match(report.diagnostics[0].message, /multiple supplied files/);
});

test('missing explicit files are errors and adjacent files are not discovered automatically', t => {
  const paths = files(t, {
    'main.sty': String.raw`\RequirePackage{base}\newcommand{\f}{x}`,
    'base.sty': String.raw`\newcommand{\leaf}{x}`,
  });
  const unresolved = inspect([paths[0]]);
  assert.equal(unresolved.complete, true);
  assert.equal(unresolved.warnings[0].kind, 'unresolved package dependency');
  assert.equal(unresolved.definitions.leaf, undefined);
  fs.unlinkSync(paths[1]);
  const missing = inspect(paths);
  assert.equal(missing.complete, false);
  assert.equal(missing.diagnostics[0].kind, 'missing dependency');
});

test('unresolved packages and their options remain warnings during renderer audits', t => {
  const paths = files(t, {
    'main.sty': '\\RequirePackage[mode]{unknown}\n\\newcommand{\\f}{x}',
    'cases.json': JSON.stringify([{command: 'f', tex: '\\f', expected: 'x'}]),
  });
  const report = audit(['--input', paths[0], '--cases', paths[1]]);
  assert.equal(report.ok, true);
  assert.equal(report.rendererChecks.length, 4);
  assert.deepEqual(report.warnings.map(w => w.kind), ['unresolved package dependency', 'unhandled package options']);
  assert.equal(report.warnings[0].line, 1);
  assert.equal(report.packages[0].options, 'mode');
});

test('external-package notes do not claim replacement bodies are compatible', t => {
  const paths = files(t, {
    'main.sty': String.raw`\RequirePackage{amsmath}\newcommand{\bad}{\unknownCommand}`,
    'cases.json': JSON.stringify([{command: 'bad', tex: '\\bad'}]),
  });
  const report = audit(['--input', paths[0], '--cases', paths[1]]);
  assert.equal(report.complete, true);
  assert.equal(report.ok, false);
  assert.equal(report.packages[0].status, 'external package recorded');
  assert.ok(report.rendererChecks.every(check => check.status === 'renderer failure'));
});

test('MathJax uses the same extension profile regardless of package declarations', t => {
  const [file] = files(t, {'main.sty': String.raw`\RequirePackage{mathtools}\newcommand{\x}{x}`});
  const context = vm.createContext({});
  vm.runInContext(inspect([file]).javascript.mathjax, context);
  assert.deepEqual(Array.from(context.MathJax.loader.load), ['[tex]/boldsymbol', '[tex]/mathtools']);
  fs.writeFileSync(file, String.raw`\DeclarePairedDelimiter{\paren}{(}{)}`);
  const paired = vm.createContext({});
  vm.runInContext(inspect([file]).javascript.mathjax, paired);
  assert.deepEqual(Array.from(paired.MathJax.loader.load), Array.from(context.MathJax.loader.load));
  assert.deepEqual(Array.from(paired.MathJax.tex.packages['[+]']), Array.from(context.MathJax.tex.packages['[+]']));
});

for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: converter warns on stderr, emits valid output, and preserves output on local-option failure`, t => {
    const [file, local] = files(t, {
      'main.sty': String.raw`\RequirePackage[mode]{unknown}\newcommand{\f}{x}`,
      'base.sty': String.raw`\newcommand{\leaf}{x}`,
    });
    const args = [`scripts/generate_${engine}.lua`, ...argumentsFor([file, local])];
    const result = spawnSync(process.env.LUA || 'luajit', args, {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /warning: unresolved package dependency/);
    assert.match(result.stderr, /warning: unhandled package options/);
    assert.equal(compiler(engine, result.stdout)('\\f'), compiler(engine)('x'));
    fs.writeFileSync(file, String.raw`\RequirePackage[mode]{base}`);
    const output = path.join(path.dirname(file), 'output.js');
    fs.writeFileSync(output, 'previous output');
    const rejected = spawnSync(process.env.LUA || 'luajit', [...args, '--output', output], {encoding: 'utf8'});
    assert.equal(rejected.status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), 'previous output');
  });
}

const complexityCases = [
  ['class', '\\class{BQP}', '\\mathsf{BQP}'],
  ['Otilde', '\\Otilde{n}', '\\tilde{\\mathcal{O}}\\mathopen{\\left(n\\right)}\\mathclose{}'],
  ...[['OO', '\\mathcal{O}'], ['Th', '\\Theta'], ['Om', '\\Omega'], ['oo', 'o'], ['om', '\\omega']]
    .map(([name, symbol]) => [name, '\\' + name + '{n}', symbol + '\\mathopen{\\left(n\\right)}\\mathclose{}']),
  ...['poly', 'polylog', 'quasipoly'].map(name => [name, '\\' + name, '\\operatorname{' + name + '}']),
  ...[['polytime', 'P'], ['NPtime', 'NP'], ['BPPtime', 'BPP'], ['EXPtime', 'EXP']]
    .map(([name, value]) => [name, '\\' + name, '\\mathsf{' + value + '}']),
];
const sample = inspect(['tests/fixtures/sample-preamble/math-core.sty', 'tests/fixtures/sample-preamble/math-complexity.sty']);
// Rendering the full core needs the explicit indicator mapping.
const mapped = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua',
  ...argumentsFor(['tests/fixtures/sample-preamble/math-core.sty', 'tests/fixtures/sample-preamble/math-complexity.sty']), '--map', 'mathds=mathbf'], {encoding: 'utf8'});
assert.equal(mapped.status, 0, mapped.stderr);
const javascript = JSON.parse(mapped.stdout).javascript;
assert.equal(sample.complete, true);
assert.equal(sample.packages.find(p => p.name === 'math-core').status, 'supplied local dependency');
for (const engine of ['mathjax', 'katex']) for (const [name, tex, expected] of complexityCases) {
  for (const display of [false, true]) test(`${engine}: complexity fixture ${name}, ${display ? 'display' : 'inline'}`, () => {
    assert.equal(compiler(engine, javascript[engine])(tex, display), compiler(engine)(expected, display));
  });
}
