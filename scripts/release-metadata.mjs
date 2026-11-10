import { readFile, writeFile, mkdir } from 'node:fs/promises';
const arg = process.argv.indexOf('--repository'),
  raw = arg >= 0 ? process.argv[arg + 1] : null;
if (!raw) throw new Error('Provide --repository with the actual public HTTPS repository URL');
const url = new URL(raw);
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname.split('/').filter(Boolean).length < 2
)
  throw new Error('Use a public HTTPS repository URL without credentials or query parameters');
const repository = url.href.replace(/\/$/, ''),
  p = JSON.parse(await readFile('package.json'));
p.repository = { type: 'git', url: repository.endsWith('.git') ? repository : repository + '.git' };
p.homepage = repository.replace(/\.git$/, '') + '#readme';
p.bugs = { url: repository.replace(/\.git$/, '') + '/issues' };
await writeFile('package.json', JSON.stringify(p, null, 2) + '\n');
await mkdir('dist/market', { recursive: true });
const index = {
  format: 1,
  title: { en: 'Studyboard', zh: '学习画板' },
  plugins: [
    {
      name: p.name,
      title: { en: 'Studyboard · Quirky Stuff', zh: '学习画板' },
      description: {
        en: 'Visual learning notes, AI summaries and source-aware knowledge graphs for DeepSeek Harness.',
        zh: p.description,
      },
      author: p.author,
      homepage: p.homepage,
      repository: { url: repository.replace(/\.git$/, '') },
      icon: 'data:image/svg+xml;base64,' + Buffer.from(await readFile('icon.svg')).toString('base64'),
      versions: [
        {
          version: p.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: { type: 'npm' },
          engines: { dsh: p.engines.dsh },
        },
      ],
    },
  ],
};
await writeFile('dist/market/index.json', JSON.stringify(index, null, 2) + '\n');
console.log(
  'Updated package metadata and generated dist/market/index.json. Publish this index only after the npm version is publicly available.',
);
