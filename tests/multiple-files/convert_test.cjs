const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function workspace(t, root) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web multiple files '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const file of ['base.sty', 'extra.sty']) {
    fs.copyFileSync(path.join(root, 'tests/fixtures/multiple-files', file), path.join(directory, file));
  }
  return {directory, files: ['base.sty', 'extra.sty'].map(file => path.join(directory, file))};
}

for (const engine of ['mathjax', 'katex']) {
  const {root, generate, load, katex, mathml} = require(`../${engine}/test_support.cjs`);
  function check(files, expected) {
    const loaded = load(files);
    if (engine === 'mathjax') {
      const macros = loaded.config.tex.macros;
      for (const [name, body] of Object.entries(expected)) assert.equal(macros[name], body);
      return Object.keys(macros);
    }
    const macros = loaded.api.createMacros(katex);
    for (const [name, body] of Object.entries(expected)) {
      assert.equal(mathml('\\' + name, macros), mathml(body));
    }
    return Object.keys(macros).map(name => name.slice(1));
  }

  test(`${engine}: ordered files, spaces, complete macro map, and deterministic output`, t => {
    const {directory, files} = workspace(t, root);
    const names = check(files, {choice: 'new', unusedBase: 'b', unusedExtra: 'e'});
    assert.deepEqual(names.sort(), ['RR', 'choice', 'domain', 'pair', 'rankop', 'unusedBase', 'unusedExtra']);
    const output = path.join(directory, 'configuration.js');
    assert.equal(generate(files, output).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), generate(files).stdout);
  });

  for (const [name, mutate, error] of [
    ['missing later file', files => { fs.unlinkSync(files[1]); }, /extra\.sty/],
    ['duplicate across files', files => {
      fs.writeFileSync(files[1], '% comment\n\\newcommand{\\choice}{bad}');
    }, /extra\.sty:2:1: duplicate definition.*base\.sty:2:1/],
    ['reversed order', files => { files.reverse(); }, /extra\.sty:1:1: cannot renew undefined/],
    ['malformed later file', files => {
      fs.appendFileSync(files[1], '\n\\newcommand{\\broken}{');
    }, /extra\.sty:\d+:1:/],
    ['repeated input', files => { files.push(files[0]); }, /base\.sty:1:1: duplicate definition/],
  ]) {
    test(`${engine}: ${name} fails without emitting or overwriting output`, t => {
      const {directory, files} = workspace(t, root);
      mutate(files);
      const output = path.join(directory, 'configuration.js');
      fs.writeFileSync(output, 'previous configuration');
      for (const destination of [undefined, output]) {
        const result = generate(files, destination);
        assert.equal(result.status, 1);
        assert.match(result.stderr, error);
        assert.equal(result.stdout, '');
      }
      assert.equal(fs.readFileSync(output, 'utf8'), 'previous configuration');
    });
  }

  test(`${engine}: endinput and trailing comments stop only their own file`, t => {
    const {files} = workspace(t, root);
    fs.appendFileSync(files[0], '\\endinput\nunsupported trailing text');
    check(files, {choice: 'new'});
    fs.writeFileSync(files[0], '\\newcommand{\\choice}{old}% no newline');
    check(files, {choice: 'new'});
  });

  test(`${engine}: document-command renewal and replacement cross file boundaries`, t => {
    const {files} = workspace(t, root);
    fs.writeFileSync(files[1], String.raw`\RenewDocumentCommand{\choice}{}{renewed}
\DeclareDocumentCommand{\RR}{}{R}
\NewDocumentCommand{\fresh}{}{f}`);
    check(files, {choice: 'renewed', RR: 'R', fresh: 'f'});
  });

  test(`${engine}: rejects malformed CLI options before touching output`, t => {
    const {directory, files} = workspace(t, root);
    const output = path.join(directory, 'configuration.js');
    fs.writeFileSync(output, 'keep');
    for (const args of [[], ['--input'], [files[0], '--input'], ['--output', output], ['--unknown', files[0]],
      ['--input', files[0], '--output', output, '-o', output]]) {
      const result = spawnSync(process.env.LUA || 'luajit', [
        path.join(root, `scripts/generate_${engine}.lua`), ...args,
      ], {encoding: 'utf8', cwd: directory});
      assert.equal(result.status, 1);
      assert.match(result.stderr, /usage:/);
      assert.equal(result.stdout, '');
    }
    assert.equal(fs.readFileSync(output, 'utf8'), 'keep');
  });
}
