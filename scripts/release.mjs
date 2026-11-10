import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir, cp, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { checkPackage, checkPackedFiles } from './check-package.mjs';
import { publicSourceFiles, writeFreshZip } from './release-files.mjs';
const exec = promisify(execFile);
const { name, version } = await checkPackage({ release: true }),
  out = resolve('dist/releases');
await mkdir(out, { recursive: true });
const [packed] = JSON.parse(
  (
    await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], {
      maxBuffer: 4000000,
    })
  ).stdout,
);
await checkPackedFiles(packed.files);
for (const f of packed.files) {
  if (!/\.(js|json|ya?ml|md|html|txt)$/.test(f.path)) continue;
  const value = await readFile(f.path, 'utf8');
  if (/\/Users\/[^/]+\/|\/home\/[^/]+\/|codex-clipboard-/.test(value))
    throw new Error('Personal development content found in ' + f.path);
}
const temp = await mkdtemp(join(tmpdir(), 'studyboard-release-')),
  extension = join(temp, 'chrome');
await mkdir(extension);
const skip = new Set(['connection.json', 'connection.json.bak', '.npmignore', 'reader-entry.js']);
for (const file of await readdir('chrome-extension'))
  if (!skip.has(file) && !file.endsWith('.log'))
    await cp(join('chrome-extension', file), join(extension, file), { recursive: true });
const zipName = name + '-chrome-' + version + '.zip';
await writeFreshZip(extension, join(out, zipName));
const sourceDir = join(temp, 'source'),
  sourceName = name + '-source-' + version + '.zip';
const tracked = (await exec('git', ['ls-files', '-z'])).stdout.split('\0').filter(Boolean);
if (!tracked.length)
  throw new Error(
    'Initialize the source repository and add public source files before creating a source archive',
  );
await mkdir(sourceDir);
for (const file of publicSourceFiles(tracked)) {
  await mkdir(join(sourceDir, file, '..'), { recursive: true });
  await cp(file, join(sourceDir, file));
}
await writeFreshZip(sourceDir, join(out, sourceName));
const artifacts = [packed.filename, zipName, sourceName],
  checks = [];
for (const file of artifacts)
  checks.push(
    createHash('sha256')
      .update(await readFile(join(out, file)))
      .digest('hex') +
      '  ' +
      file,
  );
await writeFile(join(out, 'SHA256SUMS.txt'), checks.join('\n') + '\n');
await writeFile(
  join(out, 'RELEASE-NOTES.md'),
  '# ' +
    name +
    ' ' +
    version +
    '\n\nMIT · Qiangsheng Liu\n\nDSH 0.2.2-rc.1; macOS 13+ OCR/PDF binaries for arm64 and x64.\n\nInstall the .tgz as a DSH bundle. Extract the Chrome ZIP and load it through Chrome extensions; confirm the first browser connection in DSH.\n\nExisting notes keep using storages/studyboard-v1. See the package installation and privacy documents before deployment.\n',
);
console.log(
  JSON.stringify({ directory: out, artifacts, packedBytes: packed.size, unpackedBytes: packed.unpackedSize }),
);
