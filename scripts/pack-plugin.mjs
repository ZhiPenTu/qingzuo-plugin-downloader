import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from '@commerce/plugin-sdk/cli';
import { loadPackagedManifest } from './manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = await loadPackagedManifest(root);
const stage = path.join(root, 'release/plugin');
const platform = process.platform + '-' + process.arch;
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, 'ui'), path.join(stage, 'ui'), { recursive: true });
const sdkRoot = path.dirname(fileURLToPath(import.meta.resolve('@commerce/plugin-sdk/cli')));
await cp(path.join(sdkRoot, 'index.mjs'), path.join(stage, 'ui/sdk.mjs'));
await cp(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  commerce: pkg.commerce,
}, null, 2));

const name = pkg.commerce.id + '-' + pkg.version + '-' + platform + '.ecplugin';
const artifact = path.join(root, 'release', name);
const result = await pack(stage, artifact);
const bytes = await readFile(artifact);
const fragment = path.join(root, 'release', 'catalog-' + platform + '.json');
await writeFile(fragment, JSON.stringify({
  schemaVersion: 1,
  plugins: [{
    ...pkg.commerce,
    version: pkg.version,
    artifacts: {
      [platform]: {
        url: 'https://github.com/ZhiPenTu/qingzuo-plugin-downloader/releases/download/v' + pkg.version + '/' + name,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  }],
}, null, 2) + '\n');
console.log(JSON.stringify({
  artifact: path.relative(root, artifact),
  fragment: path.relative(root, fragment),
  platform,
  size: bytes.length,
  sha256: result.sha256,
}, null, 2));
