const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const {compiler} = require('../support/renderers.cjs');
const {workspace: createWorkspace, render, copy} = require('../support/quarto.cjs');
function workspace(t) {
  const directory = createWorkspace(t);
  for (const file of ['example-environments.qmd', 'lp.lua', 'lp-macros.sty']) {
    copy(directory, path.join('examples', file));
  }
  return directory;
}
for (const engine of ['mathjax', 'katex']) {
  test(`${engine}: public lp example transforms math and raw blocks with imported notation`, t => {
    const directory = workspace(t);
    const result = render(directory, {engine, file: 'example-environments.qmd'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const dom = new JSDOM(fs.readFileSync(path.join(directory, 'example-environments.html'), 'utf8'));
    t.after(() => dom.window.close());
    const script = dom.window.document.querySelector('#math-web-macros').textContent;
    const expressions = [...dom.window.document.querySelectorAll('.math')];
    assert.equal(expressions.length, 2);
    const compile = compiler(engine, script);
    const expected = [
      String.raw`\begin{alignedat}{2}\min_x\quad&c^\top x&&\\\operatorname{subject\ to}\quad&a_i^\top x\ge b_i,&\quad&i=1,\ldots,m\\&x\ge0,&\quad&\\\end{alignedat}`,
      String.raw`\tag{$\mathrm{P}$}\begin{alignedat}{2}\min_x\quad&c^\top x&&\\\operatorname{subject\ to}\quad&Ax\ge b,&\quad&\\&x\ge0,&\quad&\\\end{alignedat}`,
    ];
    expressions.forEach((expression, index) => {
      const text = engine === 'mathjax' ? expression.textContent.slice(2, -2) : expression.textContent;
      assert.equal(compile(text, true), compiler(engine)(expected[index], true));
      assert.equal(text.includes('lpconstraint'), false);
    });
    const context = vm.createContext({}); vm.runInContext(script, context);
    const names = engine === 'mathjax' ? Object.keys(context.MathJax.tex.macros)
      : Object.keys(context.MathWebKatex.createMacros(require('katex'))).map(name => name.slice(1));
    assert.deepEqual(names.sort(), ['cost', 'subjectto']);
  });
  test(`${engine}: unrelated environment boundaries are interpreted by the renderer`, t => {
    const directory = workspace(t);
    fs.appendFileSync(path.join(directory, 'lp-macros.sty'), String.raw`\newcommand{\matstop}{\end{matrix}}`);
    fs.writeFileSync(path.join(directory, 'example-environments.qmd'), `---
format: math-web-html
math-web:
  macros: lp-macros.sty
  hooks: [lp.lua]
---

` + String.raw`$$
\begin{matrix}x\matstop +
\begin{lp}{\min_x}{\cost}
  \lpconstraint{\begin{matrix}y\matstop}
\end{lp}
$$

$$\begin{matrix}z\end{other}$$
`);
    const result = render(directory, {engine, file: 'example-environments.qmd'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const dom = new JSDOM(fs.readFileSync(path.join(directory, 'example-environments.html'), 'utf8'));
    t.after(() => dom.window.close());
    const script = dom.window.document.querySelector('#math-web-macros').textContent;
    const expressions = [...dom.window.document.querySelectorAll('.math')].map(expression =>
      engine === 'mathjax' ? expression.textContent.slice(2, -2) : expression.textContent);
    assert.equal(expressions.length, 2);
    const compile = compiler(engine, script);
    const expected = String.raw`\begin{matrix}x\end{matrix}+
\begin{alignedat}{2}\min_x\quad&c&&\\
\operatorname{subject\ to}\quad&\begin{matrix}y\end{matrix},&\quad&\\\end{alignedat}`;
    assert.equal(compile(expressions[0], true), compiler(engine)(expected, true));
    // The same build preserves malformed renderer-owned syntax for the renderer
    // to diagnose, while registered lp syntax was transformed successfully.
    assert.throws(() => compile(expressions[1], true));
  });
  for (const [name, change, message] of [
    ['unclosed environment', s => s.replace('\\end{lp}', '\\end{other}'), /missing.*end\{lp\}/],
    ['inline lp', s => s.replace(/\$\$([\s\S]*?)\$\$/, (_all, math) => '$' + math.trim().replace(/\n/g, ' ') + '$'), /lp requires display math/],
    ['missing hook', s => s.replace('- lp.lua', '- missing.lua'), /loading hook/],
    ['duplicate handlers', s => s.replace('- lp.lua', '- lp.lua\n    - lp.lua'), /duplicate environment handler/],
    ['invalid hook metadata', s => s.replace('hooks:\n    - lp.lua', 'hooks: {path: lp.lua}'), /hooks.*must be a Lua module path/],
  ]) {
    test(`${engine}: ${name} gives a useful error`, t => {
      const directory = workspace(t);
      const file = path.join(directory, 'example-environments.qmd');
      fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')));
      const result = render(directory, {engine, file: 'example-environments.qmd'});
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, message);
    });
  }
  test(`${engine}: inherited hook paths work in nested documents`, t => {
    const directory = workspace(t);
    fs.mkdirSync(path.join(directory, 'chapters'));
    fs.writeFileSync(path.join(directory, '_quarto.yml'), 'project:\n  type: default\nformat: math-web-html\nmath-web:\n  macros: lp-macros.sty\n  hooks: lp.lua\n');
    fs.writeFileSync(path.join(directory, 'chapters', 'page.qmd'), '$$\\begin{lp}{\\min_x}{\\cost}\\lpconstraint{x>0}\\end{lp}$$');
    const result = render(directory, {engine, file: 'chapters/page.qmd'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  for (const hooks of ['boundary.lua', '[boundary.lua]']) {
    test(`${engine}: hook-only configuration accepts ${hooks} and preserves TeX tokens`, t => {
      const directory = workspace(t);
      fs.writeFileSync(path.join(directory, 'boundary.lua'), String.raw`return {environments = {
  emit = {render = function() return "\\alpha" end},
  pass = {render = function(node, context)
    return context.commands(node.body, {
      emitcmd = {arguments = {"m"}, render = function() return "\\alpha" end},
    })
  end},
}}`);
      fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
math-web:
  hooks: ${hooks}
---

` + String.raw`$$\begin{emit}\end{emit}x$$

$$\begin{pass}\emitcmd{}x\end{pass}$$

$$\begin{emit}\end{emit}@x$$

$$\begin{pass}\emitcmd{}@x\end{pass}$$
`);
      const result = render(directory, {engine});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const dom = new JSDOM(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'));
      t.after(() => dom.window.close());
      const script = dom.window.document.querySelector('#math-web-macros').textContent;
      const expressions = [...dom.window.document.querySelectorAll('.math')];
      assert.equal(expressions.length, 4);
      const compile = compiler(engine, script);
      for (const [index, expression] of expressions.entries()) {
        const text = engine === 'mathjax' ? expression.textContent.slice(2, -2) : expression.textContent;
        const expected = index < 2 ? String.raw`\alpha x` : String.raw`\alpha @x`;
        assert.equal(compile(text, true), compiler(engine)(expected, true));
      }
    });
  }
  test(`${engine}: mappings work without a style file`, t => {
    const directory = workspace(t);
    fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
math-web:
  mappings:
    styled: mathsf
---

$\\styled{V}$
`);
    const result = render(directory, {engine});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const dom = new JSDOM(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'));
    t.after(() => dom.window.close());
    const script = dom.window.document.querySelector('#math-web-macros').textContent;
    assert.equal(compiler(engine, script)(String.raw`\styled{V}`), compiler(engine)(String.raw`\mathsf{V}`));
  });
  for (const key of ['hook', 'macro', 'mapping']) {
    test(`${engine}: unknown setting ${key} fails before rendering`, t => {
      const directory = workspace(t);
      fs.writeFileSync(path.join(directory, 'index.qmd'), `---
format: math-web-html
math-web:
  macros: lp-macros.sty
  ${key}: lp.lua
---

$x$
`);
      const result = render(directory, {engine});
      assert.notEqual(result.status, 0);
      assert.ok((result.stdout + result.stderr).includes(`unknown setting 'math-web.${key}'`));
      assert.equal(fs.existsSync(path.join(directory, 'index.html')), false);
    });
  }
}
