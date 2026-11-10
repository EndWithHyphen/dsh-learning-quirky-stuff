import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publicSourceFiles, writeFreshZip, validateDocumentVersions } from '../scripts/release-files.mjs';
const exec = promisify(execFile);

test('源码包排除本机 QA 记录，保留公开验证文档并拒绝私有运行文件', () => {
  assert.deepEqual(
    publicSourceFiles(['README.md', 'QA.md', 'docs/validation.md', 'tests/task-manager.test.mjs']),
    ['README.md', 'docs/validation.md', 'tests/task-manager.test.mjs'],
  );
  assert.throws(() => publicSourceFiles(['.env.local']), /Private file/);
  assert.throws(() => publicSourceFiles(['chrome-extension/connection.json']), /Private file/);
});

test('重新打包同名 ZIP 不保留之前已排除的文件', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'studyboard-fresh-archive-')),
    source = join(root, 'source'),
    zip = join(root, 'source.zip');
  await mkdir(source);
  await writeFile(join(source, 'README.md'), 'public source');
  await writeFile(join(source, 'QA.md'), 'private local record');
  await writeFreshZip(source, zip);
  await rm(join(source, 'QA.md'));
  await writeFreshZip(source, zip);
  const names = (await exec('/usr/bin/unzip', ['-Z1', zip])).stdout.trim().split('\n');
  assert.deepEqual(names, ['README.md']);
});

test('安装与发布命令必须引用当前包版本', () => {
  validateDocumentVersions(
    'npm install ./dsh-learning-quirky-stuff-4.3.1.tgz',
    'dsh-learning-quirky-stuff',
    '4.3.1',
    'install',
  );
  assert.throws(
    () =>
      validateDocumentVersions(
        'npm publish ./dsh-learning-quirky-stuff-4.0.0.tgz',
        'dsh-learning-quirky-stuff',
        '4.3.1',
        'release',
      ),
    /expected 4.3.1/,
  );
});
