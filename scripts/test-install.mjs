import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkPackage, checkPackedFiles } from './check-package.mjs';
const exec = promisify(execFile),
  p = JSON.parse(await readFile('package.json'));
await checkPackage();
const temp = await mkdtemp(join(tmpdir(), 'studyboard-install-'));
const userConfig = join(temp, 'user.npmrc'),
  globalConfig = join(temp, 'global.npmrc');
await writeFile(userConfig, '');
await writeFile(globalConfig, '');
const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^npm_config_/i.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN'].includes(key),
  ),
);
Object.assign(publicEnv, {
  NPM_CONFIG_USERCONFIG: userConfig,
  NPM_CONFIG_GLOBALCONFIG: globalConfig,
  NPM_CONFIG_CACHE: join(temp, 'npm-cache'),
  NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
});
const [packed] = JSON.parse(
  (
    await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], {
      maxBuffer: 4000000,
    })
  ).stdout,
);
await checkPackedFiles(packed.files);
const sdk = Object.fromEntries(
  Object.entries(p.peerDependencies).filter(([name]) => name !== '@deepseek-ai/dsh'),
);
await writeFile(
  join(temp, 'package.json'),
  JSON.stringify(
    {
      name: 'studyboard-package-smoke',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: { [p.name]: 'file:' + join(temp, packed.filename), ...sdk },
    },
    null,
    2,
  ),
);
await exec(
  'npm',
  [
    'install',
    '--registry=https://registry.npmjs.org',
    '--omit=dev',
    '--legacy-peer-deps',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  { cwd: temp, env: publicEnv, maxBuffer: 2000000 },
);
await writeFile(
  join(temp, 'verify.mjs'),
  `import assert from 'node:assert/strict';import{Context}from'@deepseek-ai/cordis';import{mkdtemp}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import Studyboard from ${JSON.stringify(p.name)};
const ctx=new Context();let tool;ctx.provide('llm',{listProviders:()=>[]});ctx.provide('attachments',{});ctx.provide('tools',{register:value=>{tool=value;return()=>{};}});const dataDir=await mkdtemp(join(tmpdir(),'studyboard-installed-data-'));const app=new Studyboard(ctx,{dataDir,captureEnabled:false});try{const note=await app.execute({action:'create',title:'Isolated package smoke'});await tool.execute({request:{action:'metadata',id:note.id,tags:['smoke']}});assert.deepEqual((await app.execute({action:'read',id:note.id})).tags,['smoke']);const capabilities=await app.execute({action:'system.capabilities'});assert.equal(typeof capabilities.ocr.available,'boolean');console.log(JSON.stringify({ok:true,package:${JSON.stringify(p.name)},version:${JSON.stringify(p.version)},serviceStarted:true,savedAndRead:true,ocrAvailable:capabilities.ocr.available}));}finally{await app.dispose();}`,
);
const result = await exec(process.execPath, [join(temp, 'verify.mjs')], { cwd: temp, maxBuffer: 1000000 });
console.log(result.stdout.trim());
let auditText;
try {
  auditText = (
    await exec('npm', ['audit', '--json', '--registry=https://registry.npmjs.org/'], {
      cwd: temp,
      env: publicEnv,
      maxBuffer: 4000000,
    })
  ).stdout;
} catch (error) {
  auditText = error.stdout;
}
const audit = JSON.parse(auditText || '{}');
if (!audit.metadata?.vulnerabilities) throw new Error('Installed dependency audit did not return a report');
await mkdir('dist/qa', { recursive: true });
await writeFile('dist/qa/installed-package-audit.json', JSON.stringify(audit, null, 2));
console.log(
  JSON.stringify({
    installedDependencyAudit: audit.metadata.vulnerabilities,
    note: 'Peer dependencies are supplied by the host; project-root overrides do not rewrite the consumer dependency tree.',
  }),
);
