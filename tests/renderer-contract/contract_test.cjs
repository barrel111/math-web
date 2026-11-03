const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {audit} = require('../support/preamble_audit.cjs');
const {compiler} = require('../support/renderers.cjs');

function fixture(t, source, cases = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web contract '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'notation.sty');
  const examples = path.join(directory, 'cases.json');
  fs.writeFileSync(file, source);
  fs.writeFileSync(examples, JSON.stringify(cases));
  return {file, examples};
}
function inspect(file) {
  const result = spawnSync(process.env.LUA || 'luajit', ['tests/support/inspect_preamble.lua', '--input', file], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: equivalent declaration syntax preserves macro, operator, and delimiter semantics`, t => {
    const {file} = fixture(t, String.raw`\newcommand{\classic}[2][x]{#1+#2}
\NewDocumentCommand{\modern}{O{x} m}{#1+#2}
\DeclareMathOperator*{\choosevalue}{choose}
\DeclarePairedDelimiterX{\relationpair}[2]{(}{)}{#1\delimsize\vert#2}`);
    const report = inspect(file);
    assert.equal(report.complete, true);
    const compile = compiler(engine, report.javascript[engine]);
    const reference = compiler(engine);
    assert.equal(compile(String.raw`\classic{y}+\modern{y}`), reference('x+y+x+y'));
    assert.equal(compile(String.raw`\classic[z]{y}+\modern[z]{y}`), reference('z+y+z+y'));
    assert.equal(compile(String.raw`\choosevalue_{i}x_i`, true), reference(String.raw`\operatorname*{choose}_{i}x_i`, true));
    assert.equal(compile(String.raw`\relationpair*{x}{y}`), reference(String.raw`\mathopen{\left(x\middle\vert y\right)}\mathclose{}`));
  });
  test(`${engine}: the profile supports direct math even with no imported definitions`, t => {
    const {file} = fixture(t, '');
    const report = inspect(file);
    const compile = compiler(engine, report.javascript[engine]);
    const reference = compiler(engine);
    for (const source of [String.raw`\boldsymbol{x}`, String.raw`x\xleftrightarrow{a}y`]) {
      assert.equal(compile(source), reference(source));
    }
    if (engine === 'mathjax') {
      assert.equal(compile(String.raw`\underbracket{x+y}`), reference(String.raw`\underbracket{x+y}`));
    } else {
      assert.throws(() => compile(String.raw`\underbracket{x+y}`), /underbracket/);
    }
  });
}

for (const command of ['mathds', 'textsc', 'unimplementednotation']) {
  test(`${command}: body commands are accepted as text and failures belong to rendering`, t => {
    const {file, examples} = fixture(t, `\\newcommand{\\custom}{\\${command}{x}}`,
      [{command: 'custom', tex: '\\custom'}]);
    const declarationsOnly = audit(['--input', file]);
    assert.equal(declarationsOnly.ok, true);
    assert.deepEqual(declarationsOnly.diagnostics, []);
    assert.equal(declarationsOnly.declarations[0].rendererStatus, 'untested');
    const rendered = audit(['--input', file, '--cases', examples]);
    assert.equal(rendered.complete, true);
    assert.equal(rendered.ok, false);
    assert.deepEqual(rendered.diagnostics, []);
    assert.equal(rendered.rendererChecks.length, 4);
    for (const check of rendered.rendererChecks) {
      assert.equal(check.status, 'renderer failure');
      assert.equal(check.source, file);
      assert.equal(check.line, 1);
      assert.ok(check.message.includes(command));
    }
  });
}

test('arbitrary explicit aliases work without preferred command names or substitutions', t => {
  const {file, examples} = fixture(t, String.raw`\newcommand{\custom}{\userchosenstyle{x}}`,
    [{command: 'custom', tex: '\\custom', expected: '\\mathsf{x}'}]);
  const report = audit(['--input', file, '--map', 'userchosenstyle=mathsf', '--cases', examples]);
  assert.equal(report.ok, true);
  assert.ok(report.rendererChecks.every(check => check.status === 'matched expected expansion'));
});

test('invalid aliases remain configuration errors', t => {
  const {file} = fixture(t, String.raw`\newcommand{\custom}{x}`);
  const report = audit(['--input', file, '--map', 'custom=mathrm']);
  assert.equal(report.ok, false);
  assert.equal(report.diagnostics[0].kind, 'invalid mapping');
  assert.deepEqual(report.rendererChecks, []);
});

for (const target of ['mathrm', 'mathsf']) {
  test(`CLI rejects duplicate normalized aliases targeting ${target}`, t => {
    const {file} = fixture(t, '');
    const args = ['--input', file, '--map', 'foo=mathrm', '--map', String.raw`\foo=${target}`];
    const report = audit(args);
    assert.equal(report.ok, false);
    assert.equal(report.diagnostics[0].message, String.raw`duplicate mapping for command \foo`);
    for (const engine of ['mathjax', 'katex']) {
      const converted = spawnSync(process.env.LUA || 'luajit', [`scripts/generate_${engine}.lua`, ...args], {encoding: 'utf8'});
      assert.equal(converted.status, 1);
      assert.equal(converted.stdout, '');
      assert.match(converted.stderr, /duplicate mapping/);
    }
  });
}

for (const source of [String.raw`\def\custom{x}`, String.raw`\iftrue\newcommand{\custom}{x}\fi`, String.raw`\catcode64=11`]) {
  test(`unsupported top-level execution fails parsing: ${source}`, t => {
    const {file} = fixture(t, source);
    const report = audit(['--input', file]);
    assert.equal(report.ok, false);
    assert.equal(report.complete, false);
    assert.equal(report.diagnostics[0].kind, 'unsupported syntax');
    assert.deepEqual(report.rendererChecks, []);
  });
}
