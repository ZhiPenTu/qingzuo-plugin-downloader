import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => readFile(path.join(root, filename), 'utf8');

test('static UI keeps a strict local-only content policy and exposes the complete workflow', async () => {
  const html = await read('ui/index.html');
  const app = await read('ui/app.mjs');
  const format = await read('ui/downloader-format.mjs');
  assert.match(html, /default-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+https?:/i);
  for (const id of [
    'download-url',
    'probe',
    'start-download',
    'directory-name',
    'choose-directory',
    'concurrency',
    'task-list',
    'tasks-empty',
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  for (const call of ['probe', 'pickDirectory', 'preferences', 'configure', 'start', 'list', 'pause', 'resume', 'cancel', 'remove', 'reveal']) {
    assert.match(app, new RegExp('client\\.downloads\\.' + call + '\\('));
  }
  assert.match(html, /公开 HTTPS 直链/);
  assert.match(format, /不支持断点续传/);
  assert.match(app, /已完成文件不会受影响/);
  assert.match(app, /document\.visibilityState !== 'hidden'/);
  assert.doesNotMatch(app, /innerHTML/);
});

test('task cards render only public snapshot fields and never reconstruct a download URL', async () => {
  const app = await read('ui/app.mjs');
  assert.match(app, /task\.hostname/);
  assert.match(app, /task\.directoryName/);
  assert.match(app, /task\.filename/);
  assert.doesNotMatch(app, /task\.url/);
  assert.doesNotMatch(app, /task\.directoryPath/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});
