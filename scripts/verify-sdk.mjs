import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'vendor/sdk.lock.json'), 'utf8'));
const vendor = path.join(root, 'vendor', lock.file);
const digest = createHash('sha256').update(await readFile(vendor)).digest('hex');
if (digest !== lock.sha256) throw new Error('固定 SDK 制品摘要不匹配。');

const installed = JSON.parse(await readFile(path.join(root, 'node_modules/@commerce/plugin-sdk/package.json'), 'utf8'));
if (installed.version !== lock.version) throw new Error('安装的 SDK 版本与固定版本不一致。');

if (process.env.QINGZUO_VERIFY_SDK_RELEASE === '1') {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-sdk-release-'));
  try {
    execFileSync('gh', [
      'release', 'download', 'sdk-v' + lock.version,
      '--repo', 'ZhiPenTu/qingzuo-desktop',
      '--pattern', lock.file,
      '--dir', temporary,
    ], { stdio: 'inherit' });
    const published = await readFile(path.join(temporary, lock.file));
    if (createHash('sha256').update(published).digest('hex') !== lock.sha256) {
      throw new Error('公开 SDK Release 与仓库固定的制品不一致。');
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ version: lock.version, sha256: lock.sha256, releaseChecked: process.env.QINGZUO_VERIFY_SDK_RELEASE === '1' }));
