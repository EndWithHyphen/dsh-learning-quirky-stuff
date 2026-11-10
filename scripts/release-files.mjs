import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function publicSourceFiles(tracked) {
  return tracked.filter((file) => {
    if (/(^|\/)QA\.md$/i.test(file)) return false;
    if (
      /(^|\/)(node_modules|dist|qa|connection\.json(?:\.bak)?|release\.local\.json|\.env[^/]*)(\/|$)/i.test(
        file,
      )
    )
      throw new Error('Private file in source index: ' + file);
    return true;
  });
}

export async function writeFreshZip(directory, destination) {
  const target = resolve(destination),
    temporary = target + '.' + randomUUID() + '.tmp.zip';
  try {
    await exec('/usr/bin/zip', ['-qr', temporary, '.'], { cwd: directory, maxBuffer: 1000000 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function validateDocumentVersions(text, packageName, version, file) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tarballs = [...text.matchAll(new RegExp(escaped + '-([0-9][0-9A-Za-z.+-]*)\\.tgz', 'g'))];
  for (const match of tarballs)
    if (match[1] !== version)
      throw new Error(`${file}: installation command references ${match[1]}, expected ${version}`);
}

export async function checkReleaseDocuments(packageName, version) {
  for (const file of ['README.md', 'docs/install.md', 'docs/releasing.md'])
    validateDocumentVersions(await readFile(file, 'utf8'), packageName, version, file);
}
