const {spawnSync} = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function converterArguments(input, output) {
  if (!Array.isArray(input)) {
    return output ? [input, output] : [input];
  }

  const args = [];
  for (const file of input) args.push('--input', file);
  if (output) args.push('--output', output);
  return args;
}

function generate(engine, input, output, cwd = root) {
  const script = path.join(root, `scripts/generate_${engine}.lua`);
  const args = [script, ...converterArguments(input, output)];
  return spawnSync(process.env.LUA || 'luajit', args, {cwd, encoding: 'utf8'});
}

function evaluate(javascript, globals = {}) {
  const context = vm.createContext({...globals});
  vm.runInContext(javascript, context);
  return context;
}

function load(engine, input, globals = {}) {
  const result = generate(engine, input);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return {javascript: result.stdout, context: evaluate(result.stdout, globals)};
}

module.exports = {root, generate, load};
