import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, copyFile, cp, stat, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function packageAt(file) {
  let dir = dirname(file);
  while (dir.startsWith(root)) {
    try {
      const p = JSON.parse(await readFile(join(dir, 'package.json')));
      if (p.name && p.version) return { dir, p };
    } catch {}
    dir = dirname(dir);
  }
  return null;
}
async function dependency(name, from) {
  let base = from;
  while (true) {
    const dir = join(base, 'node_modules', name);
    try {
      return { dir, p: JSON.parse(await readFile(join(dir, 'package.json'))) };
    } catch {}
    const next = dirname(base);
    if (next === base) return null;
    base = next;
  }
}
export async function generateNotices() {
  const packages = new Map(),
    metaFiles = ['client-metafile.json', 'chrome-metafile.json', 'reader-metafile.json'];
  for (const file of metaFiles) {
    let meta;
    try {
      meta = JSON.parse(await readFile(join(root, 'dist', file)));
    } catch {
      continue;
    }
    for (const input of Object.keys(meta.inputs || {})) {
      if (!input.includes('node_modules/')) continue;
      const item = await packageAt(resolve(root, input));
      if (item) packages.set(item.p.name + '@' + item.p.version, item);
    }
  }
  const project = JSON.parse(await readFile(join(root, 'package.json'))),
    queue = Object.keys(project.dependencies).map((name) => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift(),
      item = await dependency(name, from);
    if (!item) throw new Error('Missing installed dependency ' + name);
    const key = item.p.name + '@' + item.p.version;
    if (packages.has(key)) continue;
    packages.set(key, item);
    for (const name of Object.keys(item.p.dependencies || {})) queue.push({ name, from: item.dir });
  }
  const output = join(root, 'licenses/packages');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const missing = [],
    rows = [];
  for (const [key, { dir, p }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const texts = [];
    for (const name of await readdir(dir)) {
      if (!/^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name)) continue;
      const path = join(dir, name);
      if ((await stat(path)).isFile()) texts.push('--- ' + name + ' ---\n' + (await readFile(path, 'utf8')));
    }
    if (!texts.length) {
      const vendor = join(root, 'licenses/upstream', p.name.replaceAll('/', '__') + '.txt');
      try {
        const text = await readFile(vendor, 'utf8');
        const pinned = JSON.parse(await readFile(join(root, 'licenses/upstream/manifest.json')))[p.name];
        if (
          !pinned?.versions.includes(p.version) ||
          pinned.sha256 !== createHash('sha256').update(text).digest('hex')
        )
          throw new Error('Supplemental license needs review');
        texts.push(text);
      } catch {
        missing.push({ name: p.name, version: p.version, license: p.license, repository: p.repository });
      }
    }
    const filename = key.replaceAll('/', '__') + '.txt';
    if (texts.length)
      await writeFile(
        join(output, filename),
        key +
          '\nLicense: ' +
          JSON.stringify(p.license || p.licenses || 'SEE NOTICE') +
          '\n\n' +
          texts.join('\n\n'),
      );
    rows.push(
      '| ' +
        key +
        ' | ' +
        (typeof p.license === 'string'
          ? p.license
          : JSON.stringify(p.license || p.licenses || 'SEE NOTICE')) +
        ' | [Notice](licenses/packages/' +
        filename +
        ') |',
    );
  }
  if (missing.length) {
    await writeFile(join(root, 'dist/missing-licenses.json'), JSON.stringify(missing, null, 2));
    throw new Error(
      'Third-party license text missing; see dist/missing-licenses.json (' + missing.length + ' packages)',
    );
  }
  let notice =
    '# Third-party software and fonts\n\nStudyboard source is MIT licensed. Third-party components retain their own licenses. This list covers bundled browser code and declared runtime dependencies; build tools are not distributed as part of the plugin.\n\n| Component | License | Copyright and license text |\n| --- | --- | --- |\n' +
    rows.join('\n') +
    '\n\n## Fonts\n\nFonts shipped with Excalidraw retain their embedded copyright and license notices.\n\n';
  for (const name of await readdir(join(root, 'licenses/fonts')))
    notice += '- [' + name + '](licenses/fonts/' + name + ')\n';
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), notice);
  await rm(join(root, 'chrome-extension/licenses'), { recursive: true, force: true });
  await cp(join(root, 'licenses'), join(root, 'chrome-extension/licenses'), { recursive: true });
  await copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(root, 'chrome-extension/THIRD_PARTY_NOTICES.md'));
  await copyFile(join(root, 'LICENSE'), join(root, 'chrome-extension/LICENSE'));
  console.log('Prepared notices for ' + packages.size + ' software packages and bundled fonts');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generateNotices();
