(() => {
const cardElement = document.getElementById('chatCard');
const titleElement = document.getElementById('chatTitle');
const statusDotElement = document.getElementById('statusDot');
const statusTextElement = document.getElementById('statusText');
const closeButton = document.getElementById('closeButton');
const messageListElement = document.getElementById('messageList');
const emptyHintElement = document.getElementById('emptyHint');
const warningBarElement = document.getElementById('warningBar');
const warningCancelButton = document.getElementById('warningCancelButton');
const warningConfirmButton = document.getElementById('warningConfirmButton');
const inputElement = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

const AGENT_AVATAR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
    <path d="M12 4.5 13.8 9.2 18.5 11 13.8 12.8 12 17.5 10.2 12.8 5.5 11 10.2 9.2z" />
  </svg>
`;

let currentWorkspace = null;
let localError = null;
let sending = false;
let warningPending = false;

/** 上报卡片实际高度；窗口显示与否不影响该上报路径。 */
function reportHeight() {
  window.petAiChat.reportHeight(cardElement.scrollHeight + 16);
}

/** 内容尺寸变化时自动跟随上报（消息增加、警告条展开等）。 */
const cardResizeObserver = new ResizeObserver(() => {
  if (currentWorkspace) reportHeight();
});
cardResizeObserver.observe(cardElement);

/** 创建一条聊天消息气泡。 */
function createMessageRow(message) {
  const row = document.createElement('div');
  const role = message.role === 'user' ? 'user' : (message.role === 'error' ? 'error' : 'agent');
  row.className = `chat-message chat-message--${role}`;

  if (role !== 'user') {
    const avatar = document.createElement('span');
    avatar.className = 'chat-message__avatar';
    avatar.innerHTML = AGENT_AVATAR_SVG;
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-message__bubble';
  bubble.textContent = String(message.text || '');
  row.appendChild(bubble);
  return row;
}

/** 创建 Agent 处理中的打字动画行。 */
function createTypingRow() {
  const row = document.createElement('div');
  row.className = 'chat-message chat-message--agent';

  const avatar = document.createElement('span');
  avatar.className = 'chat-message__avatar';
  avatar.innerHTML = AGENT_AVATAR_SVG;

  const bubble = document.createElement('div');
  bubble.className = 'chat-message__bubble chat-typing';
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'chat-typing__dot';
    bubble.appendChild(dot);
  }
  row.append(avatar, bubble);
  return row;
}

/** 渲染消息列表，并滚动到底部。 */
function renderMessages() {
  const messages = currentWorkspace?.messages || [];
  const rows = messages.map(createMessageRow);
  if (currentWorkspace?.pending) rows.push(createTypingRow());
  if (localError) {
    rows.push(createMessageRow({ role: 'error', text: localError }));
  }
  if (rows.length === 0) {
    messageListElement.replaceChildren(emptyHintElement);
  } else {
    messageListElement.replaceChildren(...rows);
  }
  messageListElement.scrollTop = messageListElement.scrollHeight;
}

/** 同步头部状态、输入区可用性和警告条。 */
function renderControls() {
  const workspace = currentWorkspace;
  titleElement.textContent = workspace ? `${workspace.title} · Agent 工作空间` : 'AI 对话';

  const busy = Boolean(workspace && workspace.status !== 'ready');
  const pending = Boolean(workspace?.pending);
  statusDotElement.dataset.state = busy || pending ? 'busy' : 'ready';
  statusTextElement.textContent = pending
    ? 'Agent 处理中…'
    : busy
      ? String(workspace?.busy_reason || 'Agent 忙碌中')
      : '就绪，可发送调整要求';

  const locked = !workspace || busy || pending || sending;
  inputElement.disabled = locked;
  sendButton.disabled = locked || !inputElement.value.trim();
  warningBarElement.hidden = !warningPending;
}

/** 渲染主进程推送的工作空间状态。 */
function renderWorkspace(workspace) {
  const previousId = currentWorkspace?.id;
  currentWorkspace = workspace || null;
  if (!currentWorkspace || currentWorkspace.id !== previousId) {
    warningPending = false;
    localError = null;
  }
  renderMessages();
  renderControls();
  if (currentWorkspace) reportHeight();
}

/** 真正把输入内容发给 Agent 工作空间。 */
async function submitMessage() {
  const workspace = currentWorkspace;
  const message = inputElement.value.trim();
  if (!workspace || !message || sending) return;
  sending = true;
  localError = null;
  warningPending = false;
  renderMessages();
  renderControls();
  try {
    const result = await window.petAiChat.send({
      workspaceId: workspace.id,
      message,
    });
    if (result && result.success === false) {
      // 任务启动失败的错误消息由主程序写入聊天记录，这里保留输入内容即可。
      return;
    }
    inputElement.value = '';
  } catch (error) {
    localError = error instanceof Error
      ? error.message.replace(/^.*Error invoking remote method.*?:\s*(?:Error:\s*)?/, '')
      : String(error || '发送失败，请重试');
    renderMessages();
  } finally {
    sending = false;
    renderControls();
  }
}

/** 发送入口：已有正文时先弹出清空警告，确认后再提交。 */
function requestSend() {
  if (!currentWorkspace || !inputElement.value.trim()) return;
  if (currentWorkspace.has_generated_content && !warningPending) {
    warningPending = true;
    renderControls();
    return;
  }
  void submitMessage();
}

sendButton.addEventListener('click', requestSend);
warningConfirmButton.addEventListener('click', () => void submitMessage());
warningCancelButton.addEventListener('click', () => {
  warningPending = false;
  renderControls();
});
closeButton.addEventListener('click', () => window.petAiChat.close());

inputElement.addEventListener('input', () => {
  if (warningPending) warningPending = false;
  renderControls();
});
inputElement.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    requestSend();
  }
});

const unsubscribeChat = window.petAiChat.onChange(renderWorkspace);

window.addEventListener('beforeunload', () => {
  cardResizeObserver.disconnect();
  unsubscribeChat();
});
})();
