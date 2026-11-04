const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

async function build() {
  const out = path.join(__dirname, '..', 'dist');
  await fs.mkdir(out, { recursive: true });
  await esbuild.build({
    entryPoints: ['src/renderer.js'], bundle: true, outfile: 'dist/renderer.js',
    platform: 'browser', target: 'chrome140', minify: true, legalComments: 'eof'
  });
  for (const name of ['index.html', 'styles.css']) {
    await fs.copyFile(path.join('src', name), path.join(out, name));
  }
  console.log('Интерфейс собран.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
