const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

async function build() {
  const out = path.join(__dirname, '..', 'dist');
  await fs.mkdir(out, { recursive: true });
  await esbuild.build({
    entryPoints: ['src/renderer.js'], bundle: true, outfile: 'dist/renderer.js',
    platform: 'browser', target: 'chrome140', minify: true, legalComments: 'eof',
    plugins: [{ name: 'editor-compatibility', setup(build) {
      build.onLoad({ filter: /@toast-ui[\\/]editor[\\/]dist[\\/]esm[\\/]index\.js$/ }, async args => {
        const contents = await fs.readFile(args.path, 'utf8');
        const resize = 'this.handleResize = throttle_1(function () {';
        const oldSanitizer = /\/\*! @license DOMPurify 2\.3\.3[\s\S]*?var purify = createDOMPurify\(\);/;
        if (contents.split(resize).length !== 2 || !oldSanitizer.test(contents)) {
          throw new Error('Проверьте совместимость при обновлении редактора.');
        }
        // Отложенный resize библиотеки не должен обновлять уже закрытый редактор.
        const patched = contents.replace(resize, resize + '\n if (!_this.refs.el.isConnected) return;');
        // Вместо старой встроенной копии используем общий DOMPurify из проекта.
        return { contents: patched.replace(oldSanitizer, "import purify from 'dompurify';"), loader: 'js' };
      });
    } }]
  });
  await fs.copyFile('src/index.html', path.join(out, 'index.html'));
  const styles = await Promise.all([
    'node_modules/@toast-ui/editor/dist/toastui-editor.css',
    'node_modules/@toast-ui/editor/dist/theme/toastui-editor-dark.css', 'src/styles.css'
  ].map(name => fs.readFile(name, 'utf8')));
  await fs.writeFile(path.join(out, 'styles.css'), styles.map(css => css.replace(/@charset[^;]+;/g, '')).join('\n'));
  console.log('Интерфейс собран.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
