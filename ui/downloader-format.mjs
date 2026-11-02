const STATUS = {
  queued: { label: '等待中', tone: 'neutral' },
  probing: { label: '正在检测', tone: 'active' },
  downloading: { label: '下载中', tone: 'active' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'neutral' },
};

export function formatBytes(value) {
  if (value === null || value === undefined) return '大小未知';
  if (!Number.isFinite(value) || value < 0) return '大小未知';
  if (value < 1024) return Math.round(value) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let number = value / 1024;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index++;
  }
  const digits = number >= 100 ? 0 : 1;
  return number.toFixed(digits).replace(/\.0$/, '') + ' ' + units[index];
}

export function formatSpeed(value) {
  return formatBytes(Number.isFinite(value) ? Math.max(0, value) : 0) + '/s';
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

export function statusMeta(status) {
  return STATUS[status] || { label: '未知状态', tone: 'neutral' };
}

export function modeLabel(mode) {
  return mode === 'segmented' ? '多线程' : '普通下载';
}

export function probeCapability(probe) {
  if (!probe?.supportsRange) {
    return {
      title: '普通下载',
      detail: '服务器不支持断点续传，将使用单连接下载。',
      tone: 'neutral',
    };
  }
  return {
    title: '支持断点续传',
    detail: probe.mode === 'segmented' ? '将使用多线程下载。' : '文件较小，将使用单连接下载。',
    tone: 'success',
  };
}

export function taskActions(task) {
  if (task.status === 'completed') {
    return [
      { action: 'reveal', label: '打开所在文件夹', kind: 'secondary' },
      { action: 'remove', label: '清除记录', kind: 'quiet' },
    ];
  }
  if (task.status === 'canceled') return [{ action: 'remove', label: '移除', kind: 'quiet' }];
  const actions = [];
  if (task.canPause) actions.push({ action: 'pause', label: '暂停', kind: 'secondary' });
  if (task.canResume) actions.push({ action: 'resume', label: task.status === 'failed' ? '重试' : '继续', kind: 'primary' });
  if (task.canCancel) actions.push({ action: 'cancel', label: '取消', kind: 'quiet' });
  if (task.canRemove && !task.canCancel) actions.push({ action: 'remove', label: '移除', kind: 'quiet' });
  return actions;
}

export function taskMetrics(task) {
  if (task.status === 'downloading') {
    return `${formatBytes(task.transferred)} / ${task.total ? formatBytes(task.total) : '大小未知'} · ${formatSpeed(task.speed)}`;
  }
  if (task.status === 'completed') return formatBytes(task.total);
  if (task.total) return `${formatBytes(task.transferred)} / ${formatBytes(task.total)}`;
  return task.transferred ? formatBytes(task.transferred) : '等待开始';
}

export function isActiveTask(task) {
  return ['queued', 'probing', 'downloading'].includes(task.status);
}

export function taskCountLabel(count) {
  return count ? `${count} 个任务` : '暂无任务';
}

export function normalizeMessage(value) {
  if (typeof value !== 'string' || !value.trim()) return '操作没有完成，请稍后重试。';
  return value.trim().slice(0, 320);
}
