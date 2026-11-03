const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '../..');

function copy(directory, source, destination = path.basename(source)) {
  const target = path.join(directory, destination);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.cpSync(path.join(root, source), target, {recursive: true});
}

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'math-web quarto '));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  copy(directory, '_extensions');
  return directory;
}

function write(directory, file, contents) {
  const destination = path.join(directory, file);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, contents);
}

// Preserve failures so tests can assert on diagnostics and absent output files.
function render(directory, {file = 'index.qmd', engine} = {}) {
  const args = ['render', file];
  if (engine) args.push('-M', `html-math-method:${engine}`);
  const result = spawnSync(process.env.QUARTO || 'quarto', args, {
    cwd: directory, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function renderHtml(directory, options = {}) {
  const result = render(directory, options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const input = options.file || 'index.qmd';
  return fs.readFileSync(path.join(directory, input.replace(/\.qmd$/, '.html')), 'utf8');
}

module.exports = {root, workspace, copy, write, render, renderHtml};
