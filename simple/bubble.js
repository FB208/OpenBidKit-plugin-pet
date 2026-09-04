(() => {
const bubbleElement = document.getElementById('statusBubble');
const titleElement = document.getElementById('bubbleTitle');
const detailElement = document.getElementById('bubbleDetail');

/** 将主进程状态渲染为只读任务气泡。 */
function renderStatus(status) {
  const title = String(status?.title || status?.text || '当前无执行任务');
  const detail = String(status?.detail || '小易正在待命');

  titleElement.textContent = title;
  detailElement.textContent = detail;
  bubbleElement.dataset.tone = String(status?.tone || 'idle');
  bubbleElement.title = `${title} · ${detail}`;
}

const unsubscribeStatus = window.petStatus.onChange(renderStatus);

// 气泡是 fit-content 宽度，窗口两侧留白是透明的；主进程要按这个实际宽度定位，
// 否则贴屏幕边缘时会被透明留白提前顶住，气泡就和桌宠脱钩了。
function reportBubbleWidth() {
  const width = bubbleElement.hidden
    ? 0
    : Math.ceil(bubbleElement.getBoundingClientRect().width);
  window.petStatus.reportBubbleWidth(width);
}

const bubbleResizeObserver = new ResizeObserver(reportBubbleWidth);
bubbleResizeObserver.observe(bubbleElement);

// 交互气泡（问答、目录选择或 AI 对话）活跃期间隐藏只读任务气泡，避免重叠。
let questionActive = false;
let selectionActive = false;
let aiChatActive = false;
function syncBubbleHidden() {
  bubbleElement.hidden = questionActive || selectionActive || aiChatActive;
  // 隐藏时 ResizeObserver 不一定触发，主动补一次上报。
  reportBubbleWidth();
}
const unsubscribeQuestion = window.petAgentQuestion.onChange((question) => {
  questionActive = Boolean(question);
  syncBubbleHidden();
});
const unsubscribeSelection = window.petOutlineSelection.onChange((selection) => {
  selectionActive = Boolean(selection);
  syncBubbleHidden();
});
const unsubscribeAiChat = window.petAiChat.onChange((visible) => {
  aiChatActive = Boolean(visible);
  syncBubbleHidden();
});

window.addEventListener('beforeunload', () => {
  bubbleResizeObserver.disconnect();
  unsubscribeStatus();
  unsubscribeQuestion();
  unsubscribeSelection();
  unsubscribeAiChat();
});

})();
