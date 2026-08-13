(() => {
const bubbleElement = document.getElementById('statusBubble');
const titleElement = document.getElementById('bubbleTitle');
const detailElement = document.getElementById('bubbleDetail');
const iconElement = document.getElementById('bubbleIcon');

const TONE_ICONS = Object.freeze({
  idle: '•',
  running: '···',
  paused: 'Ⅱ',
  success: '✓',
  error: '!',
});

/** 将主进程状态渲染为独立任务气泡。 */
function renderStatus(status) {
  const title = String(status?.title || status?.text || '当前无执行任务');
  const detail = String(status?.detail || '小易正在待命');
  const requestedTone = String(status?.tone || 'idle');
  const tone = Object.hasOwn(TONE_ICONS, requestedTone) ? requestedTone : 'idle';

  titleElement.textContent = title;
  detailElement.textContent = detail;
  iconElement.textContent = TONE_ICONS[tone];
  bubbleElement.dataset.tone = tone;
  bubbleElement.title = `${title} · ${detail}`;
}

const unsubscribeStatus = window.petStatus.onChange(renderStatus);
// Agent 提问期间隐藏只读任务气泡，避免与快捷回答气泡重叠。
const unsubscribeQuestion = window.petAgentQuestion.onChange((question) => {
  bubbleElement.hidden = Boolean(question);
});

window.addEventListener('beforeunload', () => {
  unsubscribeStatus();
  unsubscribeQuestion();
});

})();
