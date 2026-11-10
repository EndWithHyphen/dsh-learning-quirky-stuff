import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

function publicUrl(value, location, tarball = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${location}: dependency source must use the public npm registry`);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'registry.npmjs.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (tarball ? !url.pathname.endsWith('.tgz') : url.pathname !== '/')
  )
    throw new Error(`${location}: dependency source must use ${PUBLIC_REGISTRY}`);
}

/** Offline release check. Values are never included in errors, so credentials cannot leak. */
export function validateRegistry({ lock, manifest, npmrc }) {
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object')
    throw new Error('package-lock.json: expected a version 3 lockfile with packages');
  let packages = 0;
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (entry.link || typeof entry.resolved !== 'string')
      throw new Error(`package-lock.json ${path}: dependency has no public tarball URL`);
    publicUrl(entry.resolved, `package-lock.json ${path}`, true);
    if (!entry.integrity) throw new Error(`package-lock.json ${path}: missing package integrity`);
    packages++;
  }
  if (!packages) throw new Error('package-lock.json: no locked dependencies');
  publicUrl(manifest?.publishConfig?.registry, 'package.json publishConfig.registry');
  let hasRegistry = false;
  for (const line of String(npmrc).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error('.npmrc: invalid configuration line');
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (key === 'registry' || key.endsWith(':registry')) {
      publicUrl(value, '.npmrc registry');
      if (key === 'registry') hasRegistry = true;
    }
    if (/(?:^|:)(?:_auth|_authtoken|_password|username)$/.test(key))
      throw new Error('.npmrc: authentication belongs in local or CI configuration');
  }
  if (!hasRegistry) throw new Error('.npmrc: explicitly configure the public npm registry');
  return { packages, registry: PUBLIC_REGISTRY };
}

export async function checkRegistry(root = '.') {
  const [lock, manifest, npmrc] = await Promise.all([
    readFile(join(root, 'package-lock.json'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, '.npmrc'), 'utf8'),
  ]);
  return validateRegistry({ lock: JSON.parse(lock), manifest: JSON.parse(manifest), npmrc });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkRegistry()));
