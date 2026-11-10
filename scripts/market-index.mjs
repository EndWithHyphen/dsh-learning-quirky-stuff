import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function repositoryUrl(value) {
  const raw = typeof value === 'string' ? value : value?.url;
  const url = new URL(
    String(raw || '')
      .replace(/^git\+/, '')
      .replace(/\.git\/?$/, ''),
  );
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('The public source repository must use a plain HTTPS URL');
  return url.href.replace(/\/$/, '');
}

export function publishedIndex(manifest, registry, icon, integrity) {
  const release = registry.versions?.[manifest.version],
    publishedAt = Date.parse(registry.time?.[manifest.version] || '');
  if (
    !release ||
    release.name !== manifest.name ||
    release.version !== manifest.version ||
    !Number.isFinite(publishedAt)
  )
    throw new Error('This version is not publicly available on npm; no installable index was created');
  const repository = repositoryUrl(manifest.repository);
  if (repositoryUrl(release.repository).toLowerCase() !== repository.toLowerCase())
    throw new Error('The npm release points to a different repository');
  if (
    !release.dsh?.bundle?.patch ||
    release.dsh.bundle.patch !== manifest.dsh?.bundle?.patch ||
    release.engines?.dsh !== manifest.engines?.dsh ||
    release.license !== manifest.license
  )
    throw new Error('The npm release metadata does not match this plugin');
  if (!integrity || release.dist?.integrity !== integrity)
    throw new Error('The public npm tarball does not match the verified local release');
  if (icon.length > 32768) throw new Error('The market icon exceeds 32 KiB');
  return {
    format: 1,
    title: { en: 'Studyboard', zh: '学习画板' },
    description: {
      en: 'Official release index maintained by the Studyboard project.',
      zh: '由学习画板项目维护的发布索引。',
    },
    plugins: [
      {
        name: manifest.name,
        title: { en: 'Studyboard · Quirky Stuff', zh: '学习画板' },
        description: {
          en: 'Handwritten notes and screenshots, structured AI summaries, editable infographics, source-linked knowledge graphs, spaced review and weekly reflection.',
          zh: manifest.description,
        },
        author: typeof manifest.author === 'string' ? manifest.author : manifest.author.name,
        homepage: manifest.homepage,
        repository: { url: repository },
        keywords: manifest.keywords || [],
        icon: 'data:image/svg+xml;base64,' + icon.toString('base64'),
        versions: [
          {
            version: manifest.version,
            publishTimestamp: Math.floor(publishedAt / 1000),
            source: { type: 'npm', registry: 'https://registry.npmjs.org/' },
            engines: { dsh: manifest.engines.dsh },
          },
        ],
      },
    ],
  };
}

async function main() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')),
    response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(manifest.name), {
      signal: AbortSignal.timeout(30000),
    });
  if (!response.ok) throw new Error('Cannot verify the public npm release: HTTP ' + response.status);
  const tarball = await readFile(`dist/releases/${manifest.name}-${manifest.version}.tgz`),
    integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64'),
    index = publishedIndex(manifest, await response.json(), await readFile('icon.svg'), integrity);
  const output = resolve('market/index.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(index, null, 2) + '\n');
  console.log(
    JSON.stringify({
      file: 'market/index.json',
      name: manifest.name,
      version: manifest.version,
      verifiedPublicTarball: true,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
