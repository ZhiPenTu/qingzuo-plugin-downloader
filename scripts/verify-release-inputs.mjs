import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'ZhiPenTu/qingzuo-desktop';
const hostVersion = process.env.QINGZUO_HOST_VERSION || 'v0.6.21';
const sdkVersion = 'v1.8.0';
const lock = JSON.parse(await readFile(path.join(root, 'vendor/sdk.lock.json'), 'utf8'));
const json = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
assert.match(hostVersion, /^v\d+\.\d+\.\d+$/);
assert.match(process.env.QINGZUO_HOST_RUN_ID || '', /^\d+$/);
const run = json(['run', 'view', process.env.QINGZUO_HOST_RUN_ID, '--repo', repository, '--json', 'conclusion,workflowName,headSha,headBranch']);
assert.equal(run.conclusion, 'success');
assert.equal(run.workflowName, 'Release commerce desktop');
assert.equal(run.headBranch, hostVersion);
let tag = json(['api', 'repos/' + repository + '/git/ref/tags/' + hostVersion]).object;
for (let depth = 0; tag.type === 'tag' && depth < 3; depth++) tag = json(['api', 'repos/' + repository + '/git/tags/' + tag.sha]).object;
assert.equal(tag.type, 'commit');
assert.equal(tag.sha, run.headSha);
for (const version of [hostVersion, sdkVersion]) {
  const release = json(['api', 'repos/' + repository + '/releases/tags/' + version]);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
}
const sdkRelease = json(['api', 'repos/' + repository + '/releases/tags/' + sdkVersion]);
const asset = sdkRelease.assets.find(item => item.name === lock.file);
assert.ok(asset);
const bytes = await readFile(path.join(root, 'vendor', lock.file));
assert.equal(bytes.length, asset.size);
assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), asset.digest);
assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.sha256);
console.log('Verified immutable Qingzuo ' + hostVersion + ' host run and released SDK ' + sdkVersion + ' bytes.');
