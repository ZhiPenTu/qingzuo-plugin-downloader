import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  formatPercent,
  formatSpeed,
  isActiveTask,
  modeLabel,
  normalizeMessage,
  probeCapability,
  statusMeta,
  taskActions,
  taskCountLabel,
  taskMetrics,
} from '../ui/downloader-format.mjs';

test('byte, speed, and progress formatting stay readable across magnitudes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(128 * 1024 ** 2), '128 MB');
  assert.equal(formatBytes(null), '大小未知');
  assert.equal(formatBytes(-1), '大小未知');
  assert.equal(formatSpeed(0), '0 B/s');
  assert.equal(formatSpeed(1.5 * 1024 ** 2), '1.5 MB/s');
  assert.equal(formatPercent(98.9), 98);
  assert.equal(formatPercent(120), 100);
  assert.equal(formatPercent(Number.NaN), 0);
});

test('probe results explain whether acceleration and resume are available', () => {
  assert.deepEqual(probeCapability({
    supportsRange: true,
    mode: 'segmented',
  }), {
    title: '支持断点续传',
    detail: '将使用多线程下载。',
    tone: 'success',
  });
  assert.match(probeCapability({ supportsRange: true, mode: 'single' }).detail, /单连接/);
  assert.deepEqual(probeCapability({ supportsRange: false, mode: 'single' }), {
    title: '普通下载',
    detail: '服务器不支持断点续传，将使用单连接下载。',
    tone: 'neutral',
  });
});

test('task actions follow host capabilities and never imply deleting completed files', () => {
  assert.deepEqual(taskActions({ status: 'downloading', canPause: true, canResume: false, canCancel: true, canRemove: false }).map(item => item.action), ['pause', 'cancel']);
  assert.deepEqual(taskActions({ status: 'paused', canPause: false, canResume: true, canCancel: true, canRemove: true }).map(item => item.action), ['resume', 'cancel']);
  assert.deepEqual(taskActions({ status: 'failed', canPause: false, canResume: true, canCancel: true, canRemove: true }).map(item => item.label), ['重试', '取消']);
  assert.deepEqual(taskActions({ status: 'completed', canPause: false, canResume: false, canCancel: false, canRemove: true }).map(item => item.label), ['打开所在文件夹', '清除记录']);
  assert.deepEqual(taskActions({ status: 'canceled', canPause: false, canResume: false, canCancel: false, canRemove: true }).map(item => item.action), ['remove']);
});

test('task labels and metrics remain useful before and during a transfer', () => {
  assert.equal(statusMeta('downloading').label, '下载中');
  assert.equal(statusMeta('unknown').label, '未知状态');
  assert.equal(modeLabel('segmented'), '多线程');
  assert.equal(modeLabel('single'), '普通下载');
  assert.equal(taskCountLabel(0), '暂无任务');
  assert.equal(taskCountLabel(2), '2 个任务');
  assert.equal(isActiveTask({ status: 'probing' }), true);
  assert.equal(isActiveTask({ status: 'paused' }), false);
  assert.equal(taskMetrics({ status: 'downloading', transferred: 1024, total: 4096, speed: 1024 }), '1 KB / 4 KB · 1 KB/s');
  assert.equal(taskMetrics({ status: 'completed', transferred: 4096, total: 4096 }), '4 KB');
  assert.equal(taskMetrics({ status: 'queued', transferred: 0, total: 0 }), '等待开始');
});

test('messages are bounded without exposing an empty technical error', () => {
  assert.equal(normalizeMessage(' 下载链接无效。 '), '下载链接无效。');
  assert.equal(normalizeMessage(''), '操作没有完成，请稍后重试。');
  assert.equal(normalizeMessage(null), '操作没有完成，请稍后重试。');
  assert.equal(normalizeMessage('x'.repeat(500)).length, 320);
});
