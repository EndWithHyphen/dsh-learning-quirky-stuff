import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
if (process.platform !== 'darwin')
  throw new Error('预编译识别程序需要在 macOS 构建；CI 的 macOS job 会生成两个架构。');
const source = 'native/text-reader.swift',
  sourceHash = createHash('sha256')
    .update(await readFile(source))
    .digest('hex');
for (const [arch, target] of [
  ['arm64', 'arm64-apple-macos13.0'],
  ['x64', 'x86_64-apple-macos13.0'],
]) {
  const dir = 'native/bin/darwin-' + arch,
    file = dir + '/text-reader';
  await mkdir(dir, { recursive: true });
  await exec(
    '/usr/bin/swiftc',
    [
      source,
      '-O',
      '-target',
      target,
      '-o',
      file,
      '-framework',
      'Vision',
      '-framework',
      'AppKit',
      '-framework',
      'PDFKit',
    ],
    { timeout: 120000, maxBuffer: 1000000 },
  );
  await exec(
    '/usr/bin/codesign',
    ['--force', '--sign', '-', '--identifier', 'org.studyboard.text-reader', file],
    { timeout: 30000 },
  );
  await chmod(file, 0o755);
  await writeFile(
    dir + '/manifest.json',
    JSON.stringify(
      {
        sourceHash,
        platform: 'darwin',
        arch,
        minOS: '13.0',
        sha256: createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Built local OCR/PDF reader: darwin-' + arch);
}
