import { _electron, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function launchHost(executablePath, profile) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-downloader-host-'));
  const userData = profile || path.join(temporary, 'profile');
  const environment = { ...process.env };
  delete environment.NODE_PATH;
  delete environment.NODE_OPTIONS;
  let app;
  try {
    const applicationPath = process.env.QINGZUO_HOST_APP_PATH ? [path.resolve(process.env.QINGZUO_HOST_APP_PATH)] : [];
    app = await _electron.launch({
      executablePath: path.resolve(executablePath),
      cwd: temporary,
      args: [...applicationPath, '--user-data-dir=' + userData],
      env: environment,
      timeout: 60000,
    });
    const page = await app.firstWindow();
    await expect.poll(async () => (await page.evaluate(() => window.commerceDesktop.invoke('status'))).kernel.ready, { timeout: 60000 }).toBe(true);
    return {
      app,
      page,
      temporary,
      userData,
      async close({ removeProfile = true } = {}) {
        await app.close();
        if (removeProfile) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      },
    };
  } catch (error) {
    await app?.close();
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
}

export async function installLocalPlugin(page, artifact) {
  await page.evaluate(() => window.commerceDesktop.invoke('plugins.import'));
  return page.evaluate(() => window.commerceDesktop.invoke('status'));
}

export async function patchRuntime(app, { artifact, directory, origin, marketSource = false }) {
  return app.evaluate(async ({ app, dialog }, input) => {
    const vm = process.getBuiltinModule('node:vm');
    const path = process.getBuiltinModule('node:path');
    const url = process.getBuiltinModule('node:url');
    const runtimeURL = url.pathToFileURL(path.join(app.getAppPath(), 'desktop/main.mjs')).href;
    const runtime = await vm.runInThisContext('import(' + JSON.stringify(runtimeURL) + ')', {
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
    globalThis.downloaderRuntime = runtime;
    if (input.marketSource) {
      const originalGet = runtime.manager.get.bind(runtime.manager);
      runtime.manager.get = async id => {
        const plugin = await originalGet(id);
        return id === 'official.downloader' ? { ...plugin, source: 'market' } : plugin;
      };
    }
    runtime.downloads.request = async (address, options = {}) => {
      const { allowRedirectResponses, ...requestOptions } = options;
      void allowRedirectResponses;
      const parsed = new URL(address);
      return fetch(input.origin + parsed.pathname + parsed.search, requestOptions);
    };
    dialog.showOpenDialog = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0];
      if (options?.title === '导入插件') return { canceled: false, filePaths: [input.artifact] };
      return { canceled: false, filePaths: [input.directory] };
    };
    dialog.showMessageBox = async () => ({ response: 1 });
    return true;
  }, { artifact, directory, origin, marketSource });
}

export async function openPlugin(page, app, pluginId, title) {
  await page.getByRole('button', { name: '工具中心', exact: true }).click();
  await page.locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('button', { name: /^打开(?:工具)?$/ })
    .click();
  await expect.poll(() => app.context().pages().some(candidate => candidate.url().startsWith('commerce-plugin://' + pluginId + '/')), { timeout: 60000 }).toBe(true);
  return app.context().pages().find(candidate => candidate.url().startsWith('commerce-plugin://' + pluginId + '/'));
}

export async function runtimeDownloads(app, args = { all: true }) {
  return app.evaluate(async ({ app }, value) => {
    const vm = process.getBuiltinModule('node:vm');
    const path = process.getBuiltinModule('node:path');
    const url = process.getBuiltinModule('node:url');
    const runtimeURL = url.pathToFileURL(path.join(app.getAppPath(), 'desktop/main.mjs')).href;
    const runtime = globalThis.downloaderRuntime || await vm.runInThisContext('import(' + JSON.stringify(runtimeURL) + ')', {
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
    const plugin = { id: 'official.downloader', title: '文件下载器', source: 'market', permissions: { downloads: 'manage' } };
    return runtime.downloads.list(plugin, value);
  }, args);
}
