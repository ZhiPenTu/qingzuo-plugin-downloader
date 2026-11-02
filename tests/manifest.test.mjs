import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedManifest } from '../scripts/manifest.mjs';
import { API_VERSION, validateManifest } from '@commerce/plugin-sdk/manifest';

test('manifest requests only host-managed downloads at API 1.8', async () => {
  const pkg = await loadPackagedManifest();
  const manifest = validateManifest(pkg);
  assert.equal(API_VERSION, '1.8.0');
  assert.equal(manifest.id, 'official.downloader');
  assert.equal(manifest.title, '文件下载器');
  assert.equal(manifest.api, '^1.8.0');
  assert.deepEqual(manifest.permissions, { downloads: 'manage' });
  assert.equal(manifest.backend, undefined);
  assert.equal(manifest.services, undefined);
  assert.match(manifest.icon, /^data:image\/png;base64,/);
});

test('invalid download permissions and older incompatible hosts fail manifest validation', async () => {
  const pkg = await loadPackagedManifest();
  assert.throws(() => validateManifest({
    ...pkg,
    commerce: { ...pkg.commerce, permissions: { downloads: 'write' } },
  }), /下载权限无效/);
  assert.throws(() => validateManifest({
    ...pkg,
    commerce: { ...pkg.commerce, api: '^2.0.0' },
  }), /API 版本不兼容/);
});
