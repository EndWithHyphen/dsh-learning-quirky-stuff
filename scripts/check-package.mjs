import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { checkRegistry } from './check-registry.mjs';
import { checkReleaseDocuments } from './release-files.mjs';
export async function checkPackage({ release = false } = {}) {
  await checkRegistry();
  const p = JSON.parse(await readFile('package.json')),
    m = JSON.parse(await readFile('chrome-extension/manifest.json'));
  await checkReleaseDocuments(p.name, p.version);
  if (p.private || p.license !== 'MIT' || p.name.startsWith('@local/'))
    throw new Error('Package metadata is not ready for public distribution');
  if (p.version !== m.version || !(await readFile('shared/version.js', 'utf8')).includes(p.version))
    throw new Error('Versions differ');
  for (const f of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'client.js',
    'chrome-extension/canvas.js',
    'chrome-extension/page-reader.js',
    'docs/privacy.md',
    'docs/install.md',
    'docs/user-guide.html',
    'pdf-assets/pdf.worker.min.mjs',
    'pdf-assets/cmaps/UniGB-UCS2-H.bcmap',
    'pdf-assets/standard_fonts/LiberationSans-Regular.ttf',
    'pdf-assets/wasm/openjpeg.wasm',
    'pdf-assets/LICENSE',
  ])
    await access(f);
  if (
    !(await readFile('client.js', 'utf8')).startsWith(
      'window.__ModuleLoader__.load({id:' + JSON.stringify(p.name),
    )
  )
    throw new Error('Client module ID does not match package name');
  const patch = await readFile('cordis.patch.yml', 'utf8');
  if (!patch.includes('name: ' + p.name) || /\/Users\/|extensionDir/.test(patch))
    throw new Error('Machine-specific bundle configuration');
  const rootLicense = await readFile('LICENSE', 'utf8');
  if (!rootLicense.includes('Qiangsheng Liu')) throw new Error('Copyright holder is missing');
  for (const field of [
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-home-paths',
  ])
    if (!p.peerDependencies?.[field] && !p.dependencies?.[field])
      throw new Error('Undeclared runtime SDK: ' + field);
  if (release) {
    const sourceHash = createHash('sha256')
      .update(await readFile('native/text-reader.swift'))
      .digest('hex');
    for (const arch of ['arm64', 'x64']) {
      const dir = 'native/bin/darwin-' + arch,
        meta = JSON.parse(await readFile(dir + '/manifest.json')),
        hash = createHash('sha256')
          .update(await readFile(dir + '/text-reader'))
          .digest('hex');
      if (meta.sourceHash !== sourceHash || meta.sha256 !== hash || meta.arch !== arch)
        throw new Error('Native build does not match source: ' + arch);
    }
  }
  return { name: p.name, version: p.version };
}
export async function checkPackedFiles(files) {
  for (const { path } of files)
    if (
      /(^|\/)(connection\.json(?:\.bak)?|capture\.json|release\.local\.json|\.env[^/]*|QA\.md|node_modules|qa)(\/|$)/i.test(
        path,
      ) ||
      /\.(log|tgz|zip)$/.test(path)
    )
      throw new Error('Private or unexpected file in package: ' + path);
  if (!files.some((f) => f.path === 'LICENSE') || !files.some((f) => f.path === 'THIRD_PARTY_NOTICES.md'))
    throw new Error('Missing release licenses');
  for (const path of [
    'pdf-assets/pdf.worker.min.mjs',
    'pdf-assets/cmaps/UniGB-UCS2-H.bcmap',
    'pdf-assets/standard_fonts/LiberationSans-Regular.ttf',
    'pdf-assets/wasm/openjpeg.wasm',
    'pdf-assets/LICENSE',
  ])
    if (!files.some((f) => f.path === path)) throw new Error('Missing offline PDF asset: ' + path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkPackage({ release: process.argv.includes('--release') })));
}
