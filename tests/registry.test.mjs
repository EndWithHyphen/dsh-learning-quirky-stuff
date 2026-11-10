import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistry, validateRegistry } from '../scripts/check-registry.mjs';

const fixture = () => ({
  manifest: { publishConfig: { registry: 'https://registry.npmjs.org/' } },
  npmrc: 'registry=https://registry.npmjs.org/\n',
  lock: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/@example/library': {
        version: '1.2.3',
        resolved: 'https://registry.npmjs.org/@example/library/-/library-1.2.3.tgz',
        integrity: 'sha512-test',
      },
    },
  },
});

test('公开发布检查接受实际锁文件及官方 npm 的 scoped 包', async () => {
  assert.equal(validateRegistry(fixture()).packages, 1);
  assert((await checkRegistry()).packages > 0);
});

test('拒绝私有镜像、伪装域名、凭据、非 HTTPS 和本地依赖地址', () => {
  for (const resolved of [
    'https://packages.example.invalid/library-1.2.3.tgz',
    'https://registry.npmjs.org.example.invalid/library-1.2.3.tgz',
    'https://secret@registry.npmjs.org/library-1.2.3.tgz',
    'https://registry.npmjs.org/library-1.2.3.tgz?token=secret',
    'http://registry.npmjs.org/library-1.2.3.tgz',
    'file:../library',
    'git+ssh://git@example.invalid/library.git',
  ]) {
    const input = fixture();
    input.lock.packages['node_modules/@example/library'].resolved = resolved;
    assert.throws(() => validateRegistry(input), /public npm|registry.npmjs.org/);
  }
  const input = fixture();
  input.lock.packages['node_modules/@example/library'] = { link: true, resolved: '../library' };
  assert.throws(() => validateRegistry(input), /no public tarball/);
});

test('检查 scoped registry 和发布配置，并禁止仓库携带 npm 认证项', () => {
  const input = fixture();
  input.npmrc += '@example:registry=https://packages.example.invalid/\n';
  assert.throws(() => validateRegistry(input), /npmrc registry/);
  input.npmrc = 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=test-secret';
  assert.throws(() => validateRegistry(input), /authentication/);
  input.npmrc = fixture().npmrc;
  input.manifest.publishConfig.registry = 'https://packages.example.invalid/';
  assert.throws(() => validateRegistry(input), /publishConfig/);
});
