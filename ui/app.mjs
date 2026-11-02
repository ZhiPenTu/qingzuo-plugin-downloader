import { createPluginClient } from './sdk.mjs';
import {
  formatBytes,
  formatPercent,
  isActiveTask,
  modeLabel,
  normalizeMessage,
  probeCapability,
  statusMeta,
  taskActions,
  taskCountLabel,
  taskMetrics,
} from './downloader-format.mjs';

const client = createPluginClient();
const $ = selector => document.querySelector(selector);
const els = {
  form: $('#probe-form'),
  url: $('#download-url'),
  probe: $('#probe'),
  probeResult: $('#probe-result'),
  probeMark: $('#probe-mark'),
  probeFilename: $('#probe-filename'),
  probeCapability: $('#probe-capability'),
  probeDetail: $('#probe-detail'),
  probeMeta: $('#probe-meta'),
  start: $('#start-download'),
  notice: $('#notice'),
  refresh: $('#refresh'),
  directoryName: $('#directory-name'),
  directoryState: $('#directory-state'),
  chooseDirectory: $('#choose-directory'),
  concurrency: $('#concurrency'),
  taskList: $('#task-list'),
  taskCount: $('#task-count'),
  taskError: $('#task-error'),
  tasksEmpty: $('#tasks-empty'),
  live: $('#live-indicator'),
};

const state = {
  preferences: null,
  tasks: [],
  probe: null,
  probeUrl: '',
  polling: false,
  disposed: false,
};
let noticeTimer;
let pollTimer;

function showNotice(message, tone = 'info', timeout = 4200) {
  clearTimeout(noticeTimer);
  els.notice.textContent = normalizeMessage(message);
  els.notice.className = 'notice' + (tone === 'error' ? ' error' : '');
  els.notice.hidden = false;
  if (tone !== 'error') noticeTimer = setTimeout(() => { els.notice.hidden = true; }, timeout);
}

function showTaskError(message) {
  els.taskError.textContent = normalizeMessage(message);
  els.taskError.hidden = false;
}

function clearTaskError() {
  els.taskError.textContent = '';
  els.taskError.hidden = true;
}

function setButtonWorking(button, working, label) {
  if (!button) return;
  if (working) {
    button.dataset.idleLabel ||= button.textContent;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.idleLabel || button.textContent;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function renderPreferences() {
  const preferences = state.preferences;
  if (!preferences) {
    els.directoryName.textContent = '暂不可用';
    els.directoryState.textContent = '无法读取下载设置';
    els.directoryState.classList.add('warning');
    return;
  }
  els.directoryName.textContent = preferences.directoryName;
  els.directoryState.textContent = preferences.directoryAvailable ? '' : '暂时无法访问，请重新选择';
  els.directoryState.classList.toggle('warning', !preferences.directoryAvailable);
  for (const button of els.concurrency.querySelectorAll('button[data-concurrency]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.concurrency) === preferences.concurrency));
  }
}

function renderProbe() {
  const probe = state.probe;
  if (!probe) {
    els.probeResult.hidden = true;
    return;
  }
  const capability = probeCapability(probe);
  els.probeResult.hidden = false;
  els.probeFilename.textContent = probe.filename || '待下载文件';
  els.probeFilename.title = probe.filename || '';
  els.probeCapability.textContent = capability.title;
  els.probeCapability.className = 'capability ' + capability.tone;
  els.probeDetail.textContent = capability.detail;
  els.probeMeta.textContent = [
    formatBytes(probe.size),
    probe.hostname,
    modeLabel(probe.mode),
  ].filter(Boolean).join(' · ');
  els.probeMark.className = 'probe-mark ' + capability.tone;
}

function createText(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function taskCard(task) {
  const item = document.createElement('li');
  item.className = 'task-card';
  item.dataset.taskId = task.id;

  const main = document.createElement('div');
  main.className = 'task-main';
  const top = document.createElement('div');
  top.className = 'task-topline';
  const name = createText('span', 'task-name', task.filename || '正在获取文件信息');
  name.title = task.filename || '';
  const meta = statusMeta(task.status);
  const status = createText('span', 'status ' + meta.tone, meta.label);
  top.append(name, status);
  main.append(top);

  const details = document.createElement('div');
  details.className = 'task-meta';
  details.append(
    createText('span', '', modeLabel(task.mode)),
    createText('span', '', task.ownerTitle),
    createText('span', '', task.hostname),
    createText('span', '', task.directoryName),
  );
  main.append(details);

  const unknownActive = isActiveTask(task) && !task.total;
  const progress = document.createElement('div');
  progress.className = 'progress-line' + (unknownActive ? ' indeterminate' : '');
  const fill = document.createElement('span');
  if (!unknownActive) fill.style.width = formatPercent(task.progress) + '%';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', (task.filename || '下载任务') + ' 进度');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  if (!unknownActive) progress.setAttribute('aria-valuenow', String(formatPercent(task.progress)));
  progress.append(fill);
  main.append(progress);

  main.append(createText('div', 'task-metrics', taskMetrics(task)));
  if (task.error) main.append(createText('p', 'task-error-row', normalizeMessage(task.error)));
  item.append(main);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  for (const action of taskActions(task)) {
    const button = createText('button', 'task-action ' + action.kind, action.label);
    button.type = 'button';
    button.dataset.action = action.action;
    actions.append(button);
  }
  item.append(actions);
  return item;
}

function renderTasks() {
  els.taskList.replaceChildren(...state.tasks.map(taskCard));
  els.taskCount.textContent = taskCountLabel(state.tasks.length);
  els.tasksEmpty.hidden = state.tasks.length > 0;
  els.live.hidden = !state.tasks.some(isActiveTask);
}

async function loadTasks({ quiet = false } = {}) {
  try {
    state.tasks = await client.downloads.list({ all: true });
    clearTaskError();
    renderTasks();
  } catch (error) {
    if (!quiet) showTaskError(error?.message);
  }
}

async function loadPreferences() {
  try {
    state.preferences = await client.downloads.preferences();
    renderPreferences();
  } catch (error) {
    state.preferences = null;
    renderPreferences();
    showNotice(error?.message, 'error');
  }
}

async function refresh({ manual = false } = {}) {
  if (state.polling) return;
  state.polling = true;
  if (manual) els.refresh.setAttribute('aria-busy', 'true');
  await Promise.all([loadTasks({ quiet: !manual }), loadPreferences()]);
  state.polling = false;
  els.refresh.removeAttribute('aria-busy');
}

async function handleProbe(event) {
  event.preventDefault();
  const url = els.url.value.trim();
  if (!url) {
    showNotice('请先粘贴下载链接。', 'error');
    els.url.focus();
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('下载链接必须使用 HTTPS。');
  } catch (error) {
    showNotice(error.message === '下载链接必须使用 HTTPS。' ? error.message : '下载链接格式不正确。', 'error');
    els.url.focus();
    return;
  }
  setButtonWorking(els.probe, true, '检测中…');
  state.probe = null;
  renderProbe();
  try {
    state.probe = await client.downloads.probe({ url });
    state.probeUrl = url;
    renderProbe();
  } catch (error) {
    showNotice(error?.message, 'error');
  } finally {
    setButtonWorking(els.probe, false);
  }
}

async function handleStart() {
  if (!state.probe) return;
  setButtonWorking(els.start, true, '正在加入…');
  try {
    const task = await client.downloads.start({
      url: state.probeUrl,
      filename: state.probe.filename || undefined,
      concurrency: state.preferences?.concurrency,
    });
    state.tasks = [task, ...state.tasks.filter(item => item.id !== task.id)];
    renderTasks();
    showNotice('已加入下载队列。');
    state.probe = null;
    state.probeUrl = '';
    els.url.value = '';
    renderProbe();
    els.url.focus();
  } catch (error) {
    showNotice(error?.message, 'error');
  } finally {
    setButtonWorking(els.start, false);
  }
}

async function chooseDirectory() {
  setButtonWorking(els.chooseDirectory, true, '选择中…');
  try {
    const selected = await client.downloads.pickDirectory();
    if (!selected) return;
    state.preferences = await client.downloads.configure({ directoryToken: selected.token });
    renderPreferences();
    showNotice('默认保存位置已更新。');
  } catch (error) {
    showNotice(error?.message, 'error');
  } finally {
    setButtonWorking(els.chooseDirectory, false);
  }
}

async function configureConcurrency(button) {
  if (!state.preferences) return;
  const concurrency = Number(button.dataset.concurrency);
  if (concurrency === state.preferences.concurrency) return;
  for (const item of els.concurrency.querySelectorAll('button')) item.disabled = true;
  try {
    state.preferences = await client.downloads.configure({ concurrency });
    renderPreferences();
    showNotice('下载连接数已更新。');
  } catch (error) {
    showNotice(error?.message, 'error');
  } finally {
    for (const item of els.concurrency.querySelectorAll('button')) item.disabled = false;
  }
}

function replaceTask(task) {
  state.tasks = state.tasks.map(item => item.id === task.id ? task : item);
  renderTasks();
}

async function handleTaskAction(button) {
  const card = button.closest('[data-task-id]');
  const id = card?.dataset.taskId;
  if (!id) return;
  const action = button.dataset.action;
  const original = button.textContent;
  button.textContent = '处理中…';
  button.disabled = true;
  try {
    if (action === 'pause') replaceTask(await client.downloads.pause(id));
    else if (action === 'resume') replaceTask(await client.downloads.resume(id));
    else if (action === 'cancel') {
      replaceTask(await client.downloads.cancel(id));
      showNotice('已取消下载。');
    } else if (action === 'remove') {
      await client.downloads.remove(id);
      state.tasks = state.tasks.filter(item => item.id !== id);
      renderTasks();
      showNotice('任务记录已清除，已完成文件不会受影响。');
    } else if (action === 'reveal') {
      const revealed = await client.downloads.reveal(id);
      if (!revealed) showNotice('文件位置暂时不可用。', 'error');
    }
    await loadTasks({ quiet: true });
  } catch (error) {
    showNotice(error?.message, 'error');
    button.textContent = original;
    button.disabled = false;
  }
}

els.form.addEventListener('submit', handleProbe);
els.start.addEventListener('click', handleStart);
els.chooseDirectory.addEventListener('click', chooseDirectory);
els.refresh.addEventListener('click', () => { void refresh({ manual: true }); });
els.url.addEventListener('input', () => {
  if (els.url.value.trim() !== state.probeUrl) {
    state.probe = null;
    renderProbe();
  }
});
els.concurrency.addEventListener('click', event => {
  const button = event.target.closest('button[data-concurrency]');
  if (button) void configureConcurrency(button);
});
els.taskList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button) void handleTaskAction(button);
});

renderPreferences();
renderTasks();
void refresh();
pollTimer = setInterval(() => {
  if (!state.disposed && document.visibilityState !== 'hidden' && !state.polling) void loadTasks({ quiet: true });
}, 1200);
client.onDispose(() => {
  state.disposed = true;
  clearInterval(pollTimer);
  clearTimeout(noticeTimer);
});
