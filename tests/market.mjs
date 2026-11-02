import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchHost, patchRuntime } from './launch-host.mjs';
import { startRangeServer } from './range-server.mjs';

const executablePath = process.env.QINGZUO_HOST_EXECUTABLE;
if (!executablePath) throw new Error('指定固定底座 QINGZUO_HOST_EXECUTABLE。');
const hostVersion = process.env.QINGZUO_HOST_VERSION || '0.6.21';
const pluginVersion = process.env.QINGZUO_PLUGIN_VERSION || '0.1.0';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-downloader-market-'));
const downloadDirectory = path.join(temporary, 'downloads');
const applicationRoot = process.platform === 'darwin' ? path.resolve(executablePath, '../../..') : path.dirname(executablePath);
const archive = path.join(applicationRoot, process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
const payload = Buffer.from(Array.from({ length: 2 * 1024 * 1024 }, (_, index) => (index * 41) % 251));
const server = await startRangeServer({ '/market.bin': { bytes: payload } }, { delayMs: 8, chunkSize: 32 * 1024 });
await mkdir(downloadDirectory, { recursive: true });
let host;
try {
  host = await launchHost(executablePath);
  const page = host.page;
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: '文件下载器', exact: true }) });
  await expect(card).toBeVisible({ timeout: 120000 });
  await card.getByRole('button', { name: '安装插件', exact: true }).click();
  await expect.poll(async () => {
    const status = await page.evaluate(() => window.commerceDesktop.invoke('status'));
    const installed = status.plugins.find(plugin => plugin.id === 'official.downloader');
    if (installed) return installed;
    if (await page.getByRole('alert').isVisible()) throw new Error(await page.getByRole('alert').innerText());
    return null;
  }, { timeout: 120000 }).toMatchObject({ source: 'market', enabled: true, version: pluginVersion });
  await patchRuntime(host.app, { directory: downloadDirectory, origin: server.origin });
  await page.getByRole('button', { name: '工具中心', exact: true }).click();
  const installedCard = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: '文件下载器', exact: true }) });
  await installedCard.getByRole('button', { name: /^打开(?:工具)?$/ }).click();
  await expect.poll(() => host.app.context().pages().some(candidate => candidate.url().startsWith('commerce-plugin://official.downloader/'))).toBe(true);
  const plugin = host.app.context().pages().find(candidate => candidate.url().startsWith('commerce-plugin://official.downloader/'));
  await plugin.locator('#choose-directory').click();
  await expect(plugin.locator('#directory-name')).toHaveText(path.basename(downloadDirectory));
  await plugin.locator('#download-url').fill('https://downloads.example/market.bin');
  await plugin.locator('#probe').click();
  await expect(plugin.locator('#probe-capability')).toHaveText('支持断点续传');
  await plugin.locator('#start-download').click();
  const id = await plugin.locator('.task-card').filter({ hasText: 'market.bin' }).getAttribute('data-task-id');
  await expect.poll(async () => (await plugin.evaluate(taskId => window.commercePlugin.invoke('downloads.get', { id: taskId }), id))?.status, { timeout: 60000 }).toBe('completed');
  const task = await plugin.evaluate(taskId => window.commercePlugin.invoke('downloads.get', { id: taskId }), id);
  expect(createHash('sha256').update(await readFile(path.join(downloadDirectory, task.filename))).digest('hex'))
    .toBe(createHash('sha256').update(payload).digest('hex'));
  expect(server.stats.maxActive).toBeGreaterThan(1);
  expect(createHash('sha256').update(await readFile(archive)).digest('hex')).toBe(digest);
  await mkdir('output', { recursive: true });
  await plugin.screenshot({ path: 'output/market-installed.png' });
  await writeFile('output/market-verification.json', JSON.stringify({
    platform: process.platform + '-' + process.arch,
    hostVersion,
    hostRunId: process.env.QINGZUO_HOST_RUN_ID || null,
    hostSha256: digest,
    pluginVersion,
    source: 'signed public market',
    hostUnchanged: true,
    maxActiveSegments: server.stats.maxActive,
  }, null, 2));
  console.log('Signed public downloader installation passed; pinned host unchanged.');
} finally {
  await host?.close().catch(() => {});
  await server.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
