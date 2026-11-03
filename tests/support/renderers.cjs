const vm = require('node:vm');
const katex = require('katex');
const {mathjax} = require('@mathjax/src/js/mathjax.js');
const {TeX} = require('@mathjax/src/js/input/tex.js');
const {STATE} = require('@mathjax/src/js/core/MathItem.js');
const {SerializedMmlVisitor} = require('@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js');
const {liteAdaptor} = require('@mathjax/src/js/adaptors/liteAdaptor.js');
require('@mathjax/src/js/handlers/html.js').RegisterHTMLHandler(liteAdaptor());
for (const [folder, name] of [
  ['ams', 'Ams'], ['newcommand', 'Newcommand'], ['configmacros', 'ConfigMacros'],
  ['boldsymbol', 'Boldsymbol'], ['mathtools', 'Mathtools'],
]) require(`@mathjax/src/js/input/tex/${folder}/${name}Configuration.js`);

function compiler(engine, javascript = '') {
  const context = vm.createContext({});
  vm.runInContext(javascript, context);
  if (engine === 'katex') {
    const macros = context.MathWebKatex ? context.MathWebKatex.createMacros(katex) : {};
    return (source, display = false) => katex.renderToString(source, {
      macros, displayMode: display, output: 'mathml', throwOnError: true,
    }).replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
  }
  const configured = context.MathJax?.tex || {};
  // Clone data into this realm so MathJax can merge its nested default options.
  const options = JSON.parse(JSON.stringify(configured));
  options.preFilters = Array.from(configured.preFilters || []);
  const requested = context.MathJax?.loader?.load || [];
  options.packages = ['base', 'ams', 'newcommand', 'configmacros'];
  for (const name of ['boldsymbol', 'mathtools']) {
    if (!javascript || requested.includes('[tex]/' + name)) options.packages.push(name);
  }
  options.formatError = (_jax, error) => { throw error; };
  const document = mathjax.document('', {InputJax: new TeX(options)});
  return (source, display = false) => {
    const tree = document.convert(source, {display, end: STATE.COMPILED});
    return new SerializedMmlVisitor().visitTree(tree).replace(/ data-latex(?:-item)?="[^"]*"/g, '');
  };
}
module.exports = {compiler};
