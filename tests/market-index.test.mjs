import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedIndex } from '../scripts/market-index.mjs';

const manifest = {
  name: 'dsh-example',
  version: '1.0.0',
  repository: { url: 'https://github.com/example/dsh-example.git' },
  author: 'Example contributors',
  homepage: 'https://github.com/example/dsh-example#readme',
  description: '学习笔记',
  keywords: ['dsh-plugin'],
  license: 'MIT',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  engines: { dsh: '>=0.2.2-rc.1 <0.3.0' },
};
const registry = () => ({
  versions: {
    '1.0.0': {
      ...manifest,
      repository: { url: 'git+https://github.com/example/dsh-example.git' },
      dist: { integrity: 'sha512-verified' },
    },
  },
  time: { '1.0.0': '2026-11-11T00:00:00.000Z' },
});
test('市场索引只引用已发布且与本地安装包一致的 npm 版本', () => {
  const index = publishedIndex(manifest, registry(), Buffer.from('<svg/>'), 'sha512-verified');
  assert.equal(index.plugins[0].versions[0].publishTimestamp, 1794355200);
  assert.equal(index.plugins[0].versions[0].source.registry, 'https://registry.npmjs.org/');
  assert.equal(index.plugins[0].repository.url, 'https://github.com/example/dsh-example');
});
test('未发布、仓库不匹配或安装包不一致时拒绝生成市场索引', () => {
  assert.throws(
    () => publishedIndex(manifest, {}, Buffer.from('x'), 'sha512-verified'),
    /not publicly available/,
  );
  const wrong = registry();
  wrong.versions['1.0.0'].repository.url = 'https://github.com/someone/another.git';
  assert.throws(
    () => publishedIndex(manifest, wrong, Buffer.from('x'), 'sha512-verified'),
    /different repository/,
  );
  assert.throws(
    () => publishedIndex(manifest, registry(), Buffer.from('x'), 'sha512-other'),
    /does not match/,
  );
});
