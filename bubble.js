(() => {
const bubbleElement = document.getElementById('statusBubble');
const titleElement = document.getElementById('bubbleTitle');
const detailElement = document.getElementById('bubbleDetail');
const aiButtonElement = document.getElementById('bubbleAiButton');

/** 将主进程状态渲染为独立任务气泡。 */
function renderStatus(status) {
  const title = String(status?.title || status?.text || '当前无执行任务');
  const detail = String(status?.detail || '小易正在待命');

  titleElement.textContent = title;
  detailElement.textContent = detail;
  bubbleElement.dataset.tone = String(status?.tone || 'idle');
  bubbleElement.title = `${title} · ${detail}`;
}

const unsubscribeStatus = window.petStatus.onChange(renderStatus);

// 视觉层整层穿透；悬停 AI 图标时让主进程临时恢复鼠标命中以接收点击。
aiButtonElement.addEventListener('mouseenter', () => window.petAiButton.setInteractive(true));
aiButtonElement.addEventListener('mouseleave', () => window.petAiButton.setInteractive(false));
aiButtonElement.addEventListener('click', () => window.petAiButton.click());

// 交互气泡（问答、目录选择或 AI 对话）活跃期间隐藏只读任务气泡，避免重叠。
let questionActive = false;
let selectionActive = false;
let aiChatActive = false;
function syncBubbleHidden() {
  bubbleElement.hidden = questionActive || selectionActive || aiChatActive;
  // 气泡隐藏时 AI 图标随之消失，mouseleave 不一定触发，强制恢复整层穿透。
  if (bubbleElement.hidden) window.petAiButton.setInteractive(false);
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
  unsubscribeStatus();
  unsubscribeQuestion();
  unsubscribeSelection();
  unsubscribeAiChat();
});

})();
