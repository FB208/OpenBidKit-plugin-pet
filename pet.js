const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('statusText');

/** 将主进程发送的状态应用到悬浮窗口。 */
function renderStatus(status) {
  const text = String(status?.text || '当前无执行任务');
  const tone = String(status?.tone || 'idle');
  statusTextElement.textContent = text;
  statusElement.dataset.tone = tone;
  statusElement.title = text;
}

window.petStatus.onChange(renderStatus);
