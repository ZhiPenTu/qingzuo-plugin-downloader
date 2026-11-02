import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installLocalPlugin, launchHost, openPlugin, patchRuntime, runtimeDownloads } from './launch-host.mjs';
import { startRangeServer } from './range-server.mjs';

const executablePath = process.env.QINGZUO_HOST_EXECUTABLE;
if (!executablePath) throw new Error('指定固定底座 QINGZUO_HOST_EXECUTABLE。');
const pluginVersion = process.env.QINGZUO_PLUGIN_VERSION || '0.1.0';
const hostVersion = process.env.QINGZUO_HOST_VERSION || '0.6.21';
const platform = process.platform + '-' + process.arch;
const artifact = path.resolve('release/official.downloader-' + pluginVersion + '-' + platform + '.ecplugin');
const temporary = path.join(os.tmpdir(), 'qingzuo-downloader-test-' + process.pid + '-' + Date.now());
const downloadDirectory = path.join(temporary, 'downloads');
const payloads = {
  '/segmented.bin': { bytes: Buffer.from(Array.from({ length: 4 * 1024 * 1024 }, (_, index) => (index * 37) % 251)) },
  '/slow.bin': { bytes: Buffer.from(Array.from({ length: 4 * 1024 * 1024 }, (_, index) => (index * 53 + 11) % 253)) },
  '/single.bin': { bytes: Buffer.from(Array.from({ length: 768 * 1024 }, (_, index) => (index * 17) % 249)), single: true },
};
const server = await startRangeServer(payloads, { delayMs: 14, chunkSize: 32 * 1024 });
await mkdir(downloadDirectory, { recursive: true });
let host;
const pageErrors = [];

async function prepare(current) {
  current.app.context().on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  await patchRuntime(current.app, {
    artifact,
    directory: downloadDirectory,
    origin: server.origin,
    marketSource: true,
  });
}

async function taskSnapshot(plugin, id) {
  return plugin.evaluate(taskId => window.commercePlugin.invoke('downloads.get', { id: taskId }), id);
}

async function waitTask(plugin, id, statuses, timeout = 60000) {
  await expect.poll(async () => (await taskSnapshot(plugin, id))?.status, { timeout }).toMatch(new RegExp('^(?:' + statuses.join('|') + ')$'));
  return taskSnapshot(plugin, id);
}

async function waitBytes(plugin, id, minimum, timeout = 60000) {
  await expect.poll(async () => (await taskSnapshot(plugin, id)).transferred, { timeout }).toBeGreaterThan(minimum);
}

async function startDownload(plugin, url) {
  await plugin.locator('#download-url').fill(url);
  await plugin.locator('#probe').click();
  await expect(plugin.locator('#probe-result')).toBeVisible();
  await plugin.locator('#start-download').click();
  const card = plugin.locator('.task-card').filter({ hasText: path.basename(new URL(url).pathname) }).first();
  await expect(card).toBeVisible();
  return card.getAttribute('data-task-id');
}

try {
  host = await launchHost(executablePath, path.join(temporary, 'profile'));
  host.app.context().on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  await host.app.evaluate(({ dialog }, input) => {
    dialog.showOpenDialog = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0];
      return {
        canceled: false,
        filePaths: [options?.title === '导入插件' ? input.artifact : input.directory],
      };
    };
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { artifact, directory: downloadDirectory });
  const status = await installLocalPlugin(host.page, artifact);
  expect(status.plugins.find(plugin => plugin.id === 'official.downloader')).toMatchObject({ title: '文件下载器', enabled: true });
  await prepare(host);

  let plugin = await openPlugin(host.page, host.app, 'official.downloader', '文件下载器');
  await plugin.locator('#choose-directory').click();
  await expect(plugin.locator('#directory-name')).toHaveText(path.basename(downloadDirectory));
  await plugin.locator('#concurrency button[data-concurrency="2"]').click();
  await expect(plugin.locator('#concurrency button[data-concurrency="2"]')).toHaveAttribute('aria-pressed', 'true');
  await plugin.locator('#concurrency button[data-concurrency="4"]').click();
  await expect(plugin.locator('#concurrency button[data-concurrency="4"]')).toHaveAttribute('aria-pressed', 'true');

  await plugin.locator('#download-url').fill('https://downloads.example/segmented.bin');
  await plugin.locator('#probe').click();
  await expect(plugin.locator('#probe-capability')).toHaveText('支持断点续传');
  await expect(plugin.locator('#probe-detail')).toContainText('多线程');
  await plugin.locator('#start-download').click();
  const segmentedId = await plugin.locator('.task-card').filter({ hasText: 'segmented.bin' }).getAttribute('data-task-id');
  const segmented = await waitTask(plugin, segmentedId, ['completed']);
  expect(segmented.mode).toBe('segmented');
  expect(server.stats.maxActive).toBeGreaterThan(1);
  expect(server.stats.maxActive).toBeLessThanOrEqual(4);
  expect(JSON.stringify(segmented)).not.toContain('downloads.example/segmented.bin');
  expect(JSON.stringify(segmented)).not.toContain(downloadDirectory);
  expect(createHash('sha256').update(await readFile(path.join(downloadDirectory, segmented.filename))).digest('hex'))
    .toBe(createHash('sha256').update(payloads['/segmented.bin'].bytes).digest('hex'));

  await plugin.locator('#download-url').fill('https://downloads.example/single.bin');
  await plugin.locator('#probe').click();
  await expect(plugin.locator('#probe-capability')).toHaveText('普通下载');
  await plugin.locator('#start-download').click();
  const singleId = await plugin.locator('.task-card').filter({ hasText: 'single.bin' }).getAttribute('data-task-id');
  const single = await waitTask(plugin, singleId, ['completed']);
  expect(single.mode).toBe('single');
  expect(createHash('sha256').update(await readFile(path.join(downloadDirectory, single.filename))).digest('hex'))
    .toBe(createHash('sha256').update(payloads['/single.bin'].bytes).digest('hex'));

  const slowId = await startDownload(plugin, 'https://downloads.example/slow.bin');
  await waitBytes(plugin, slowId, 100 * 1024);
  await plugin.locator('.task-card[data-task-id="' + slowId + '"] button[data-action="pause"]').click();
  const paused = await waitTask(plugin, slowId, ['paused']);
  expect(paused.transferred).toBeGreaterThan(0);
  await plugin.locator('.task-card[data-task-id="' + slowId + '"] button[data-action="resume"]').click();
  const resumed = await waitTask(plugin, slowId, ['completed']);
  expect(createHash('sha256').update(await readFile(path.join(downloadDirectory, resumed.filename))).digest('hex'))
    .toBe(createHash('sha256').update(payloads['/slow.bin'].bytes).digest('hex'));

  const closingId = await startDownload(plugin, 'https://downloads.example/slow.bin');
  await waitBytes(plugin, closingId, 100 * 1024);
  await host.page.evaluate(() => window.commerceDesktop.invoke('view.close', { id: 'official.downloader' }));
  await expect.poll(async () => (await runtimeDownloads(host.app)).find(task => task.id === closingId)?.status, { timeout: 60000 }).toBe('completed');
  plugin = await openPlugin(host.page, host.app, 'official.downloader', '文件下载器');
  await expect(plugin.locator('.task-card[data-task-id="' + closingId + '"]')).toContainText('已完成');

  const restartId = await startDownload(plugin, 'https://downloads.example/slow.bin');
  await waitBytes(plugin, restartId, 200 * 1024);
  const beforeRestart = await taskSnapshot(plugin, restartId);
  expect(beforeRestart.transferred).toBeGreaterThan(0);
  await host.close();
  host = await launchHost(executablePath, host.userData);
  await prepare(host);
  plugin = await openPlugin(host.page, host.app, 'official.downloader', '文件下载器');
  await expect.poll(async () => (await taskSnapshot(plugin, restartId))?.status, { timeout: 60000 }).toMatch(/^(paused|queued|downloading|completed)$/);
  const recovered = await taskSnapshot(plugin, restartId);
  if (recovered.status !== 'completed') {
    if (recovered.status !== 'paused') {
      await plugin.evaluate(id => window.commercePlugin.invoke('downloads.pause', { id }), restartId);
    }
    await plugin.evaluate(id => window.commercePlugin.invoke('downloads.resume', { id }), restartId);
  }
  const completed = await waitTask(plugin, restartId, ['completed']);
  expect(completed.transferred).toBe(payloads['/slow.bin'].bytes.length);
  expect(createHash('sha256').update(await readFile(path.join(downloadDirectory, completed.filename))).digest('hex'))
    .toBe(createHash('sha256').update(payloads['/slow.bin'].bytes).digest('hex'));
  expect((await stat(path.join(downloadDirectory, completed.filename))).size).toBe(payloads['/slow.bin'].bytes.length);
  expect(pageErrors).toEqual([]);

  await mkdir('output', { recursive: true });
  await plugin.screenshot({ path: 'output/host-downloads.png' });
  console.log(JSON.stringify({
    platform,
    hostVersion,
    pluginVersion,
    segmentedMaxActive: server.stats.maxActive,
    tasks: (await runtimeDownloads(host.app)).length,
    pageErrors: pageErrors.length,
  }, null, 2));
} finally {
  await host?.close().catch(() => {});
  await server.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
