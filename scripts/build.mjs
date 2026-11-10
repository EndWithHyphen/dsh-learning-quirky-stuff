import { build } from 'esbuild';
import { format } from 'prettier';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { excalidrawChinese } from './excalidraw-locale.mjs';
import { excalidrawCancellation } from './excalidraw-cancellation.mjs';
import { VERSION } from '../shared/version.js';
import { buildGuide } from './build-guide.mjs';
for (const file of ['package.json', 'chrome-extension/manifest.json']) {
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  if (metadata.version !== VERSION) throw new Error(file + ' 的版本与 shared/version.js 不一致');
}
const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  'shared/identity.js',
  await format(
    '// Generated from package.json by the build.\nexport const PACKAGE_NAME = ' +
      JSON.stringify(packageInfo.name) +
      ';\nexport const BRIDGE_PROTOCOL = 2;\n',
    { parser: 'babel', singleQuote: true },
  ),
);
await buildGuide();
const result = await build({
  entryPoints: ['src/client.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  metafile: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  plugins: [excalidrawChinese(), excalidrawCancellation()],
  logLevel: 'warning',
});
await writeFile(
  'client.js',
  `window.__ModuleLoader__.load({id:${JSON.stringify(packageInfo.name)},factory(require){var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`,
);
await mkdir('dist', { recursive: true });
await writeFile('dist/client-metafile.json', JSON.stringify(result.metafile));
console.log(`Built client.js: ${(result.outputFiles[0].contents.length / 1024 / 1024).toFixed(2)} MB`);
const chromeBuild = await build({
  metafile: true,
  entryPoints: ['src/chrome-canvas.jsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  minify: true,
  outfile: 'chrome-extension/canvas.js',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  plugins: [excalidrawChinese(), excalidrawCancellation()],
  logLevel: 'warning',
});
await writeFile('dist/chrome-metafile.json', JSON.stringify(chromeBuild.metafile));
await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'chrome-extension/assets/fonts', {
  recursive: true,
});
console.log('Built Chrome canvas and packaged local fonts');

const readerBuild = await build({
  metafile: true,
  entryPoints: ['chrome-extension/reader-entry.js'],
  bundle: true,
  format: 'iife',
  globalName: 'StudyboardPageReader',
  platform: 'browser',
  target: 'chrome116',
  minify: true,
  outfile: 'chrome-extension/page-reader.js',
  logLevel: 'warning',
});
await writeFile('dist/reader-metafile.json', JSON.stringify(readerBuild.metafile));
console.log('Built browser material reader');

const { generateNotices } = await import('./third-party.mjs');
await generateNotices();

const privacy = (await readFile('docs/privacy.md', 'utf8'))
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
await writeFile(
  'chrome-extension/privacy.html',
  '<!doctype html><meta charset="utf-8"><title>学习画板数据处理说明</title><style>body{max-width:850px;margin:40px auto;padding:0 20px;font:15px/1.8 system-ui}pre{white-space:pre-wrap;font:inherit}</style><pre>' +
    privacy +
    '</pre>',
);
