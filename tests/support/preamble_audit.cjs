#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function argumentsForAudit(args) {
  const inputs = [];
  let cases;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index], value = args[index + 1];
    if (!value) throw new Error('every option requires a value');
    if (option === '--cases' && !cases) cases = value;
    else if (option === '--input' || option === '--map') inputs.push(option, value);
    else throw new Error('unknown or repeated option: ' + option);
  }
  if (!inputs.includes('--input')) throw new Error('at least one --input is required');
  return {inputs, cases};
}

function audit(args) {
  const {inputs, cases} = argumentsForAudit(args);
  const result = spawnSync(process.env.LUA || 'luajit', [path.join(__dirname, 'inspect_preamble.lua'), ...inputs], {encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  const report = JSON.parse(result.stdout);
  const javascript = report.javascript;
  delete report.javascript;
  const definitions = report.definitions || {};
  report.declarations = Object.values(definitions).map(({name, source, line, column, kind, mapped}) =>
    ({name, source, line, column, kind, mapped: !!mapped, rendererStatus: 'untested'}));
  delete report.definitions;
  report.rendererChecks = [];
  if (cases && javascript) {
    const examples = JSON.parse(fs.readFileSync(cases, 'utf8'));
    if (!Array.isArray(examples)) throw new Error('cases must be a JSON array');
    const {compiler} = require('./renderers.cjs');
    for (const engine of ['mathjax', 'katex']) {
      for (const example of examples) {
        if (typeof example.tex !== 'string') throw new Error('each case must contain tex');
        const expected = example.expected && typeof example.expected === 'object' ? example.expected[engine] : example.expected;
        if (example.expected !== undefined && typeof expected !== 'string') {
          throw new Error('expected must be a string or contain a string for each renderer');
        }
        for (const display of [false, true]) {
          const check = {engine, case: example.name || example.tex, command: example.command, display};
          try {
            const actual = compiler(engine, javascript[engine])(example.tex, display);
            if (expected !== undefined && actual !== compiler(engine)(expected, display)) {
              throw new Error('MathML differs from the expected expansion');
            }
            check.status = example.expected === undefined ? 'rendered' : 'matched expected expansion';
          } catch (error) {
            check.status = 'renderer failure';
            check.message = error.message || String(error);
            const origin = definitions[example.command];
            if (origin) Object.assign(check, {source: origin.source, line: origin.line, column: origin.column});
          }
          report.rendererChecks.push(check);
        }
      }
    }
    for (const declaration of report.declarations) {
      const checks = report.rendererChecks.filter(check => check.command === declaration.name);
      if (checks.length) declaration.rendererStatus = checks.some(check => check.status === 'renderer failure')
        ? 'renderer failure' : 'tested invocations passed in both renderers';
    }
  }
  report.ok = report.complete && !report.diagnostics.length
    && !report.rendererChecks.some(check => check.status === 'renderer failure');
  report.scope = 'Explicit files in input order; no package execution or automatic discovery. Declaration parsing does not validate replacement-body commands. Package warnings are not compatibility guarantees. Renderer results cover supplied invocations under the fixed renderer profile, not all possible arguments.';
  return report;
}

function main() {
  try {
    const report = audit(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(error.message + '\nusage: node tests/support/preamble_audit.cjs --input FILE [--input FILE ...] [--map SOURCE=TARGET] [--cases CASES.json]\n');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = {audit, main};
