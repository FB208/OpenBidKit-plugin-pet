const path = require('path');
const { BrowserWindow, Menu, ipcMain, screen } = require('electron');

const PLUGIN_ID = 'openbidkit-pet';
const STATUS_CHANNEL = `plugin:${PLUGIN_ID}:status`;
const BUBBLE_WIDTH_CHANNEL = `plugin:${PLUGIN_ID}:bubble-width`;
const PET_READY_CHANNEL = `plugin:${PLUGIN_ID}:pet-ready`;
const PET_DRAG_START_CHANNEL = `plugin:${PLUGIN_ID}:pet-drag-start`;
const PET_DRAG_END_CHANNEL = `plugin:${PLUGIN_ID}:pet-drag-end`;
const PET_CLICK_CHANNEL = `plugin:${PLUGIN_ID}:pet-click`;
const PET_CONTEXT_MENU_CHANNEL = `plugin:${PLUGIN_ID}:pet-context-menu`;
const AGENT_QUESTION_CHANNEL = `plugin:${PLUGIN_ID}:agent-question`;
const AGENT_QUESTION_HEIGHT_CHANNEL = `plugin:${PLUGIN_ID}:agent-question-height`;
const AGENT_QUESTION_ANSWER_CHANNEL = `plugin:${PLUGIN_ID}:agent-question-answer`;
const AGENT_QUESTION_SUPPRESS_CHANNEL = `plugin:${PLUGIN_ID}:agent-question-suppress`;
const OUTLINE_SELECTION_CHANNEL = `plugin:${PLUGIN_ID}:outline-selection`;
const OUTLINE_SELECTION_HEIGHT_CHANNEL = `plugin:${PLUGIN_ID}:outline-selection-height`;
const OUTLINE_SELECTION_CONFIRM_CHANNEL = `plugin:${PLUGIN_ID}:outline-selection-confirm`;
const OUTLINE_SELECTION_SUPPRESS_CHANNEL = `plugin:${PLUGIN_ID}:outline-selection-suppress`;
const OUTLINE_SELECTION_DISMISS_CHANNEL = `plugin:${PLUGIN_ID}:outline-selection-dismiss`;
const AI_CHAT_CHANNEL = `plugin:${PLUGIN_ID}:ai-chat`;
const AI_CHAT_HEIGHT_CHANNEL = `plugin:${PLUGIN_ID}:ai-chat-height`;
const AI_CHAT_SEND_CHANNEL = `plugin:${PLUGIN_ID}:ai-chat-send`;
const AI_CHAT_CLOSE_CHANNEL = `plugin:${PLUGIN_ID}:ai-chat-close`;

const PET_WINDOW_WIDTH = 96;
const PET_WINDOW_HEIGHT = 96;
const BUBBLE_WINDOW_WIDTH = 420;
const BUBBLE_WINDOW_HEIGHT = 136;
const BUBBLE_WINDOW_GAP = 8;
// bubble.css 的 body 内边距：气泡视觉边缘比窗口边缘内缩这么多。
const BUBBLE_CONTENT_INSET = 32;
const BUBBLE_EDGE_MARGIN = 8;
const INTERACTIVE_WINDOW_WIDTH = 420;
const INTERACTIVE_WINDOW_DEFAULT_HEIGHT = 320;
const INTERACTIVE_WINDOW_MIN_HEIGHT = 160;
const INTERACTIVE_WINDOW_GAP = 10;
const AI_CHAT_REFRESH_DELAY_MS = 300;
const TRANSIENT_NOTICE_DURATION_MS = 4000;
const WINDOW_MARGIN = 24;
const DRAG_FRAME_INTERVAL_MS = 16;
// 拖动兜底：渲染层 pointerup 丢失时不至于让窗口一直粘着光标。
const DRAG_MAX_DURATION_MS = 60_000;
// 渲染层没能上报 logo 就绪时，页面加载完这么久后强制显示桌宠。
const PET_SHOW_FALLBACK_MS = 1_500;
// 卡片的 CSS 与完整版共用，这里就地注入覆盖，只影响简化版：
// 去掉全部过渡与动画；去掉卡片投影，改用 1px 中性描边（原描边是白色，浅色桌面上等于没有边界）。
const SIMPLE_OVERRIDE_CSS = `
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}

body > main {
  box-shadow: none !important;
  border-color: rgb(15 23 42 / 14%) !important;
}
`;

const TASK_LABELS = Object.freeze({
  'bid-section-extraction': '多标段识别',
  'bid-analysis': '招标文件解析',
  'outline-generation': '目录生成',
  'outline-adjustment': '目录AI调整',
  'global-facts-generation': '全局事实设定',
  'content-generation': '正文生成',
  'rejection-items-extraction': '无效与废标项解析',
  'rejection-check-run': '废标项检查',
  'duplicate-analysis': '标书查重分析',
});

const TERMINAL_DELAYS = Object.freeze({
  paused: 3000,
  success: 3000,
  error: 5000,
});

const runtime = {
  ctx: null,
  petWindow: null,
  bubbleWindow: null,
  agentQuestionWindow: null,
  outlineSelectionWindow: null,
  aiChatWindow: null,
  hostWindow: null,
  unsubscribeTask: null,
  unsubscribeAgentQuestion: null,
  unsubscribeWorkspaceChat: null,
  unsubscribeWorkspacesChanged: null,
  terminalTimer: null,
  transientNoticeTimer: null,
  aiChatRefreshTimer: null,
  dragFrameTimer: null,
  dragState: null,
  ipcRegistered: false,
  petHiddenByUser: false,
  bubbleRendererReady: false,
  // 气泡实际绘制宽度；渲染层上报前按整窗宽兜底，等价于修复前的行为。
  bubblePillWidth: BUBBLE_WINDOW_WIDTH,
  agentQuestionRendererReady: false,
  outlineSelectionRendererReady: false,
  aiChatRendererReady: false,
  aiChatOpen: false,
  aiChatWorkspace: null,
  latestStatus: null,
  latestAgentQuestion: null,
  latestOutlineSelection: null,
  outlineSelectionDismissedTaskId: null,
};

/** 创建空闲状态。 */
function createIdleStatus() {
  return {
    text: '当前无执行任务',
    tone: 'idle',
    title: '当前无执行任务',
    detail: '小易正在待命',
    taskType: null,
    status: 'idle',
    progress: 0,
  };
}

runtime.latestStatus = createIdleStatus();

/** 将数值限制在指定闭区间。 */
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** 获取任务的中文名称。 */
function getTaskLabel(task) {
  return TASK_LABELS[task.type] || String(task.type || '任务');
}

/** 将任务进度限制为可展示的整数百分比。 */
function normalizeProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/** 提取正文生成任务的阶段进度展示信息。 */
function getContentProgressPresentation(task, label, progress) {
  const detail = task.type === 'content-generation' ? task.progress_detail : null;
  if (!detail?.phase_label) return null;

  const phaseLabel = String(detail.phase_label);
  const stepLabel = String(detail.step_label || '').trim();
  const phaseProgress = normalizeProgress(detail.phase_progress);
  const stepPrefix = stepLabel && stepLabel !== phaseLabel ? `${stepLabel} · ` : '';
  return {
    title: `${label} · ${phaseLabel}`,
    runningDetail: `${stepPrefix}总体 ${progress}% · 阶段 ${phaseProgress}%`,
    pausingDetail: `正在暂停 · 总体 ${progress}% · 阶段 ${phaseProgress}%`,
    pausedDetail: `已暂停 · 总体 ${progress}% · 阶段 ${phaseProgress}%`,
    errorDetail: `执行失败 · 总体 ${progress}% · 阶段 ${phaseProgress}%`,
    phase: detail.phase,
    phaseProgress,
  };
}

/** 将主程序任务转换为悬浮窗展示状态。 */
function createTaskStatus(task) {
  const label = getTaskLabel(task);
  const progress = normalizeProgress(task.progress);
  const contentProgress = getContentProgressPresentation(task, label, progress);
  const base = {
    taskType: task.type,
    status: task.status,
    progress,
    phase: contentProgress?.phase || null,
    phaseProgress: contentProgress?.phaseProgress || 0,
  };

  const outlineSelection = task.type === 'outline-generation'
    ? task.stats?.outline_selection
    : null;
  const awaitingOutlineSelection = Boolean(
    task.status === 'running'
    && (
      task.stats?.agent?.status === 'waiting-outline-selection'
      || (outlineSelection?.items?.length && !outlineSelection.confirmed)
    )
  );
  if (awaitingOutlineSelection) {
    return {
      ...base,
      title: '需要确认一级目录',
      detail: '请在主程序中完成选择',
      text: '需要确认一级目录',
      tone: 'paused',
      awaitingOutlineSelection: true,
    };
  }

  if (task.status === 'running') {
    return contentProgress
      ? { ...base, title: contentProgress.title, detail: contentProgress.runningDetail, text: `${contentProgress.title} · ${progress}%`, tone: 'running' }
      : { ...base, title: label, detail: `正在执行 · ${progress}%`, text: `${label} · ${progress}%`, tone: 'running' };
  }
  if (task.status === 'pausing') {
    return { ...base, title: contentProgress?.title || label, detail: contentProgress?.pausingDetail || `正在暂停 · ${progress}%`, text: `${label} · 正在暂停`, tone: 'paused' };
  }
  if (task.status === 'paused') {
    return { ...base, title: contentProgress?.title || label, detail: contentProgress?.pausedDetail || '已暂停', text: `${label} · 已暂停`, tone: 'paused' };
  }
  if (task.status === 'success') {
    return { ...base, title: label, detail: '已完成', text: `${label} · 已完成`, tone: 'success' };
  }
  if (task.status === 'error') {
    return { ...base, title: contentProgress?.title || label, detail: contentProgress?.errorDetail || '执行失败', text: `${label} · 执行失败`, tone: 'error' };
  }

  return { ...base, title: label, detail: `正在执行 · ${progress}%`, text: `${label} · ${progress}%`, tone: 'running' };
}

/** 比较任务更新时间，用于选择最近活动的任务。 */
function compareTaskUpdatedAt(left, right) {
  const leftTime = Date.parse(left.updated_at || left.started_at || '') || 0;
  const rightTime = Date.parse(right.updated_at || right.started_at || '') || 0;
  return rightTime - leftTime;
}

/** 读取最近的运行中任务，可排除刚刚结束的任务。 */
function getLatestActiveTask(excludedTaskId = null) {
  if (!runtime.ctx) return null;
  const tasks = runtime.ctx.getActiveTasks();
  return tasks
    .filter((task) => ['running', 'pausing'].includes(task.status))
    .filter((task) => !excludedTaskId || task.task_id !== excludedTaskId)
    .sort(compareTaskUpdatedAt)[0] || null;
}

/** 向仍然有效的插件窗口发送渲染消息。 */
function sendToWindow(win, channel, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  win.webContents.send(channel, payload);
}

/** 读取桌宠窗口当前位置与尺寸。 */
function getPetBounds() {
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return null;
  const [x, y] = win.getPosition();
  return { x, y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT };
}

/** 计算首次显示位置，固定为主屏幕工作区右下角，保证桌宠始终可见。 */
function getInitialPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - PET_WINDOW_WIDTH - WINDOW_MARGIN,
    y: workArea.y + workArea.height - PET_WINDOW_HEIGHT - WINDOW_MARGIN,
  };
}

/** 计算状态气泡在桌宠附近且不越出工作区的位置。 */
function calculateBubbleWindowPosition(petBounds) {
  const { workArea } = screen.getDisplayMatching(petBounds);
  // 气泡是 fit-content 宽度并在窗口内居中，两侧留白全透明。夹取必须按药丸的可见
  // 边缘算，否则窗口会被透明留白提前顶住（实测左右各 100px），桌宠贴边时气泡脱钩。
  const pillWidth = clamp(runtime.bubblePillWidth, 0, BUBBLE_WINDOW_WIDTH);
  const pillInset = Math.round((BUBBLE_WINDOW_WIDTH - pillWidth) / 2);
  const minimumX = workArea.x + BUBBLE_EDGE_MARGIN - pillInset;
  const maximumX = Math.max(
    minimumX,
    workArea.x + workArea.width - BUBBLE_WINDOW_WIDTH - BUBBLE_EDGE_MARGIN + pillInset,
  );
  const minimumY = workArea.y + BUBBLE_EDGE_MARGIN;
  const maximumY = Math.max(
    minimumY,
    workArea.y + workArea.height - BUBBLE_WINDOW_HEIGHT - BUBBLE_EDGE_MARGIN,
  );
  const desiredX = petBounds.x
    + Math.round((PET_WINDOW_WIDTH - BUBBLE_WINDOW_WIDTH) / 2);
  const aboveY = petBounds.y - BUBBLE_WINDOW_HEIGHT
    + BUBBLE_CONTENT_INSET - BUBBLE_WINDOW_GAP;
  const belowY = petBounds.y + PET_WINDOW_HEIGHT
    + BUBBLE_WINDOW_GAP - BUBBLE_CONTENT_INSET;
  const desiredY = aboveY >= minimumY
    ? aboveY
    : (belowY <= maximumY ? belowY : clamp(aboveY, minimumY, maximumY));

  return {
    x: clamp(desiredX, minimumX, maximumX),
    y: desiredY,
  };
}

/** 计算交互气泡在桌宠附近且不越出工作区的位置。 */
function calculateInteractiveWindowPosition(petBounds, windowWidth, windowHeight) {
  const { workArea } = screen.getDisplayMatching(petBounds);
  const minimumX = workArea.x + BUBBLE_EDGE_MARGIN;
  const maximumX = Math.max(
    minimumX,
    workArea.x + workArea.width - windowWidth - BUBBLE_EDGE_MARGIN,
  );
  const minimumY = workArea.y + BUBBLE_EDGE_MARGIN;
  const maximumY = Math.max(
    minimumY,
    workArea.y + workArea.height - windowHeight - BUBBLE_EDGE_MARGIN,
  );
  const desiredX = petBounds.x
    + Math.round((PET_WINDOW_WIDTH - windowWidth) / 2);
  const aboveY = petBounds.y - windowHeight - INTERACTIVE_WINDOW_GAP;
  const belowY = petBounds.y + PET_WINDOW_HEIGHT + INTERACTIVE_WINDOW_GAP;
  const desiredY = aboveY >= minimumY
    ? aboveY
    : (belowY <= maximumY ? belowY : clamp(aboveY, minimumY, maximumY));

  return {
    x: clamp(desiredX, minimumX, maximumX),
    y: desiredY,
  };
}

/** 将交互窗口贴近桌宠当前位置；找不到桌宠时保持原位。 */
function positionInteractiveWindow(win) {
  if (!win || win.isDestroyed()) return;
  const petBounds = getPetBounds();
  if (!petBounds) return;
  const { width, height } = win.getBounds();
  const position = calculateInteractiveWindowPosition(petBounds, width, height);
  win.setPosition(position.x, position.y);
}

/** 立即显示交互窗口；显示流程不依赖渲染层任何回报。 */
function showInteractiveWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (runtime.petHiddenByUser) return;
  positionInteractiveWindow(win);
  if (!win.isVisible()) win.showInactive();
  win.moveTop();
}

/** 隐藏交互窗口。 */
function hideInteractiveWindow(win) {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
}

/** 接收气泡实际绘制宽度，并立即按新宽度重新定位。 */
function handleBubbleWidth(event, requestedWidth) {
  if (!isWindowSender(event, runtime.bubbleWindow)) return;
  const width = clamp(Math.ceil(Number(requestedWidth) || 0), 0, BUBBLE_WINDOW_WIDTH);
  if (width === 0 || width === runtime.bubblePillWidth) return;
  runtime.bubblePillWidth = width;
  syncBubblePosition();
}

/** 让状态气泡跟随桌宠窗口。 */
function syncBubblePosition() {
  const win = runtime.bubbleWindow;
  if (!win || win.isDestroyed()) return;
  const petBounds = getPetBounds();
  if (!petBounds) return;
  const position = calculateBubbleWindowPosition(petBounds);
  win.setPosition(position.x, position.y);
}

/** 向状态气泡发送最新任务状态。 */
function publishStatus(status) {
  runtime.latestStatus = status;
  if (runtime.bubbleRendererReady) {
    sendToWindow(runtime.bubbleWindow, STATUS_CHANNEL, status);
  }
}

/** 计算当前应显示的一级目录选择状态：问答优先，稍后处理豁免。 */
function getVisibleOutlineSelection() {
  const selection = runtime.latestOutlineSelection;
  if (!selection) return null;
  if (runtime.latestAgentQuestion) return null;
  if (runtime.outlineSelectionDismissedTaskId === selection.task_id) return null;
  return selection;
}

/** 判断 AI 对话框当前是否应该可见：问答与目录选择优先。 */
function isAiChatVisible() {
  return Boolean(
    runtime.aiChatOpen
    && !runtime.latestAgentQuestion
    && !getVisibleOutlineSelection()
  );
}

/** 统一调度问答、目录选择与 AI 对话三个交互气泡的显隐。 */
function syncInteractiveWindows() {
  const question = runtime.latestAgentQuestion;
  const selection = getVisibleOutlineSelection();
  const aiChatVisible = isAiChatVisible();

  // 问答与目录确认会阻塞主程序流程，即使用户隐藏了桌宠也必须唤回。
  if (question || selection) showPet();

  // 状态气泡据此让位，避免与交互卡片重叠。
  if (runtime.bubbleRendererReady) {
    sendToWindow(runtime.bubbleWindow, AGENT_QUESTION_CHANNEL, question);
    sendToWindow(runtime.bubbleWindow, OUTLINE_SELECTION_CHANNEL, selection);
    sendToWindow(runtime.bubbleWindow, AI_CHAT_CHANNEL, aiChatVisible);
  }

  if (question) {
    ensureAgentQuestionWindow();
    showInteractiveWindow(runtime.agentQuestionWindow);
  } else {
    hideInteractiveWindow(runtime.agentQuestionWindow);
  }

  if (selection) {
    ensureOutlineSelectionWindow();
    showInteractiveWindow(runtime.outlineSelectionWindow);
  } else {
    hideInteractiveWindow(runtime.outlineSelectionWindow);
  }

  if (aiChatVisible) {
    ensureAiChatWindow();
    showInteractiveWindow(runtime.aiChatWindow);
  } else {
    hideInteractiveWindow(runtime.aiChatWindow);
  }
}

/** 拖动时让可见的交互气泡跟随桌宠。 */
function syncInteractiveWindowPositions() {
  if (runtime.latestAgentQuestion) positionInteractiveWindow(runtime.agentQuestionWindow);
  if (getVisibleOutlineSelection()) positionInteractiveWindow(runtime.outlineSelectionWindow);
  if (isAiChatVisible()) positionInteractiveWindow(runtime.aiChatWindow);
}

/** 将最新 Agent 问题同步到问答窗口并调度显隐。 */
function publishAgentQuestion(question) {
  runtime.latestAgentQuestion = question || null;
  if (runtime.agentQuestionRendererReady) {
    sendToWindow(runtime.agentQuestionWindow, AGENT_QUESTION_CHANNEL, runtime.latestAgentQuestion);
  }
  syncInteractiveWindows();
}

/** 接收主程序推送的 Agent 问题状态。 */
function handleAgentQuestion(question) {
  publishAgentQuestion(question);
}

/** 从任务对象提取待确认的一级目录选择；不满足条件时返回 null。 */
function extractOutlineSelection(task) {
  if (task?.type !== 'outline-generation') return null;
  if (!['running', 'pausing'].includes(task.status)) return null;
  const selection = task.stats?.outline_selection;
  if (!selection?.items?.length || selection.confirmed) return null;
  return {
    task_id: task.task_id,
    items: selection.items,
    selected_ids: Array.isArray(selection.selected_ids) ? selection.selected_ids : [],
    auto_answer_at: selection.auto_answer_at,
  };
}

/** 将最新一级目录选择同步到选择窗口并调度显隐。 */
function publishOutlineSelection(selection) {
  const next = selection || null;
  if (!next) {
    runtime.outlineSelectionDismissedTaskId = null;
  } else if (
    runtime.outlineSelectionDismissedTaskId
    && runtime.outlineSelectionDismissedTaskId !== next.task_id
  ) {
    runtime.outlineSelectionDismissedTaskId = null;
  }
  runtime.latestOutlineSelection = next;
  if (runtime.outlineSelectionRendererReady) {
    sendToWindow(runtime.outlineSelectionWindow, OUTLINE_SELECTION_CHANNEL, next);
  }
  syncInteractiveWindows();
}

/** 启动时从活动任务恢复待确认的一级目录选择。 */
function restorePendingOutlineSelection() {
  if (!runtime.ctx) return;
  const tasks = runtime.ctx.getActiveTasks();
  const pendingTask = tasks.find((task) => extractOutlineSelection(task));
  publishOutlineSelection(pendingTask ? extractOutlineSelection(pendingTask) : null);
}

/** 显示当前活动任务；没有任务时显示空闲。 */
function publishLatestActiveOrIdle(excludedTaskId = null) {
  const activeTask = getLatestActiveTask(excludedTaskId);
  publishStatus(activeTask ? createTaskStatus(activeTask) : createIdleStatus());
}

/** 清理终态停留计时器。 */
function clearTerminalTimer() {
  if (runtime.terminalTimer) {
    clearTimeout(runtime.terminalTimer);
    runtime.terminalTimer = null;
  }
}

/** 清理气泡临时提示计时器。 */
function clearTransientNoticeTimer() {
  if (runtime.transientNoticeTimer) {
    clearTimeout(runtime.transientNoticeTimer);
    runtime.transientNoticeTimer = null;
  }
}

/** 在状态气泡上短暂显示一条提示，数秒后恢复原状态。 */
function showTransientNotice(text, detail) {
  clearTransientNoticeTimer();
  publishStatus({
    text,
    tone: 'idle',
    title: text,
    detail: detail || '',
    taskType: null,
    status: 'notice',
    progress: 0,
  });
  runtime.transientNoticeTimer = setTimeout(() => {
    runtime.transientNoticeTimer = null;
    publishLatestActiveOrIdle();
  }, TRANSIENT_NOTICE_DURATION_MS);
}

/** 清理 AI 对话刷新去抖计时器。 */
function clearAiChatRefreshTimer() {
  if (runtime.aiChatRefreshTimer) {
    clearTimeout(runtime.aiChatRefreshTimer);
    runtime.aiChatRefreshTimer = null;
  }
}

/** 将最新工作空间状态同步到 AI 对话窗口。 */
function publishAiChatState() {
  if (!runtime.aiChatRendererReady) return;
  sendToWindow(
    runtime.aiChatWindow,
    AI_CHAT_CHANNEL,
    runtime.aiChatOpen ? runtime.aiChatWorkspace : null,
  );
}

/** 从工作空间列表中取出当前生效项；同时最多一个。 */
function findActiveWorkspace(workspaces) {
  return (workspaces || []).find((workspace) => workspace.active === true) || null;
}

/** 打开中的对话必须仍是生效项；否则关闭，不自动切到新空间。 */
function syncOpenAiChatWithWorkspaces(workspaces) {
  if (!runtime.aiChatOpen) return;
  const active = findActiveWorkspace(workspaces);
  if (!active || active.id !== runtime.aiChatWorkspace?.id) {
    closeAiChat();
    return;
  }
  runtime.aiChatWorkspace = active;
  publishAiChatState();
}

/** 重新读取 Agent 工作空间列表并刷新 AI 对话内容。 */
function refreshAiChatWorkspace() {
  if (!runtime.ctx || !runtime.aiChatOpen) return;
  if (typeof runtime.ctx.listAgentWorkspaces !== 'function') return;
  let workspaces = [];
  try {
    workspaces = runtime.ctx.listAgentWorkspaces() || [];
  } catch (error) {
    runtime.ctx.logger.error('读取 Agent 工作空间失败:', error);
    return;
  }
  syncOpenAiChatWithWorkspaces(workspaces);
}

/** 主程序推送工作空间变更：切步时关闭已打开且不再生效的对话。 */
function handleWorkspacesChanged(event) {
  if (Array.isArray(event?.workspaces)) {
    syncOpenAiChatWithWorkspaces(event.workspaces);
    return;
  }
  refreshAiChatWorkspace();
}

/** 任务事件后延迟刷新 AI 对话，避免高频任务事件反复读库。 */
function scheduleAiChatRefresh() {
  if (!runtime.aiChatOpen) return;
  clearAiChatRefreshTimer();
  runtime.aiChatRefreshTimer = setTimeout(() => {
    runtime.aiChatRefreshTimer = null;
    refreshAiChatWorkspace();
  }, AI_CHAT_REFRESH_DELAY_MS);
}

/** 打开当前生效的 AI 对话；没有生效项时关闭并提示。 */
function openAiChat() {
  if (!runtime.ctx) return;
  showPet();
  if (typeof runtime.ctx.listAgentWorkspaces !== 'function') {
    showTransientNotice('主程序版本不支持 AI 对话', '请升级易标主程序后重试');
    return;
  }
  let workspaces = [];
  try {
    workspaces = runtime.ctx.listAgentWorkspaces() || [];
  } catch (error) {
    runtime.ctx.logger.error('读取 Agent 工作空间失败:', error);
    showTransientNotice('读取 Agent 工作空间失败', '请稍后重试');
    return;
  }
  const active = findActiveWorkspace(workspaces);
  if (!active) {
    closeAiChat();
    showTransientNotice('当前步骤没有可对话的工作空间');
    return;
  }
  runtime.aiChatWorkspace = active;
  runtime.aiChatOpen = true;
  publishAiChatState();
  syncInteractiveWindows();
}

/** 关闭 AI 对话框（保留聊天记录，由主程序内存维护）。 */
function closeAiChat() {
  if (!runtime.aiChatOpen) return;
  runtime.aiChatOpen = false;
  clearAiChatRefreshTimer();
  publishAiChatState();
  syncInteractiveWindows();
}

/** 点击桌宠：切换对话框开关。 */
function toggleAiChat() {
  if (runtime.aiChatOpen) {
    closeAiChat();
  } else {
    openAiChat();
  }
}

/** 接收主程序推送的工作空间聊天事件。 */
function handleWorkspaceChatEvent(event) {
  if (!runtime.aiChatOpen) return;
  if (event?.workspace_id && event.workspace_id !== runtime.aiChatWorkspace?.id) return;
  refreshAiChatWorkspace();
}

/** 处理主程序任务事件并更新展示状态。 */
function handleTaskEvent(event) {
  const task = event?.task;
  if (!task) return;

  if (task.type === 'outline-generation') {
    publishOutlineSelection(extractOutlineSelection(task));
  }

  scheduleAiChatRefresh();
  clearTransientNoticeTimer();
  clearTerminalTimer();

  if (task.status === 'running' || task.status === 'pausing') {
    publishStatus(createTaskStatus(task));
    return;
  }

  const terminalDelay = TERMINAL_DELAYS[task.status];
  if (terminalDelay) {
    const nextActiveTask = getLatestActiveTask(task.task_id);
    if (nextActiveTask) {
      publishStatus(createTaskStatus(nextActiveTask));
      return;
    }

    publishStatus(createTaskStatus(task));
    runtime.terminalTimer = setTimeout(() => {
      runtime.terminalTimer = null;
      publishLatestActiveOrIdle();
    }, terminalDelay);
    return;
  }

  publishLatestActiveOrIdle(task.task_id);
}

/** 显示桌宠与状态气泡。 */
function showPet() {
  runtime.petHiddenByUser = false;
  const petWindow = runtime.petWindow;
  if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
    petWindow.showInactive();
    petWindow.moveTop();
  }
  const bubbleWindow = runtime.bubbleWindow;
  if (
    runtime.bubbleRendererReady
    && bubbleWindow
    && !bubbleWindow.isDestroyed()
    && !bubbleWindow.isVisible()
  ) {
    syncBubblePosition();
    bubbleWindow.showInactive();
  }
}

/** 隐藏桌宠及其全部附属窗口，直到用户或主程序再次唤起。 */
function hidePet() {
  runtime.petHiddenByUser = true;
  stopPetDrag();
  hideInteractiveWindow(runtime.agentQuestionWindow);
  hideInteractiveWindow(runtime.outlineSelectionWindow);
  hideInteractiveWindow(runtime.aiChatWindow);
  hideInteractiveWindow(runtime.bubbleWindow);
  const petWindow = runtime.petWindow;
  if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) petWindow.hide();
}

/** 把桌宠放回主屏右下角。 */
function resetPetPosition() {
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  const position = getInitialPosition();
  win.setPosition(position.x, position.y);
}

/** 停止光标跟随并清理拖动状态。 */
function stopPetDrag() {
  if (runtime.dragFrameTimer) {
    clearInterval(runtime.dragFrameTimer);
    runtime.dragFrameTimer = null;
  }
  runtime.dragState = null;
}

/** 每帧按光标绝对坐标更新桌宠窗口位置。 */
function advancePetDrag() {
  const state = runtime.dragState;
  const win = runtime.petWindow;
  if (!state || !win || win.isDestroyed()) {
    stopPetDrag();
    return;
  }
  if (Date.now() - state.startedAt > DRAG_MAX_DURATION_MS) {
    stopPetDrag();
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const nextX = Math.round(state.windowOrigin.x + (cursor.x - state.cursorOrigin.x));
  const nextY = Math.round(state.windowOrigin.y + (cursor.y - state.cursorOrigin.y));
  if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
    stopPetDrag();
    return;
  }

  const [currentX, currentY] = win.getPosition();
  if (currentX === nextX && currentY === nextY) return;
  win.setPosition(nextX, nextY);
  // 同帧把气泡与交互卡片一起挪走：'move' 事件是异步派发的，等它回调会慢一帧、拖出拖影。
  syncBubblePosition();
  syncInteractiveWindowPositions();
}

/** 桌宠窗口落位后同步气泡与交互卡片。 */
function handlePetWindowMove() {
  syncBubblePosition();
  syncInteractiveWindowPositions();
}

/** 校验消息确实来自指定的插件窗口。 */
function isWindowSender(event, win) {
  return Boolean(
    win
    && !win.isDestroyed()
    && !win.webContents.isDestroyed()
    && event.sender === win.webContents
  );
}

/** logo 解码完成，首帧可以安全显示。 */
function handlePetReady(event) {
  if (!isWindowSender(event, runtime.petWindow)) return;
  if (runtime.petHiddenByUser) return;
  const win = runtime.petWindow;
  if (!win.isVisible()) {
    win.showInactive();
    win.moveTop();
  }
}

/** 按下 logo：记录光标与窗口原点，开始跟随。 */
function handlePetDragStart(event) {
  if (!isWindowSender(event, runtime.petWindow)) return;
  stopPetDrag();
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  runtime.dragState = {
    cursorOrigin: screen.getCursorScreenPoint(),
    windowOrigin: { x, y },
    startedAt: Date.now(),
  };
  runtime.dragFrameTimer = setInterval(advancePetDrag, DRAG_FRAME_INTERVAL_MS);
}

/** 松开 logo：结束跟随。 */
function handlePetDragEnd(event) {
  if (!isWindowSender(event, runtime.petWindow)) return;
  stopPetDrag();
}

/** 单击 logo：切换 AI 对话框。 */
function handlePetClick(event) {
  if (!isWindowSender(event, runtime.petWindow)) return;
  toggleAiChat();
}

/** 右键 logo：弹出上下文菜单。 */
function handlePetContextMenu(event) {
  if (!isWindowSender(event, runtime.petWindow)) return;
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  stopPetDrag();
  const menu = Menu.buildFromTemplate([
    {
      label: runtime.aiChatOpen ? '关闭 AI 对话' : '打开 AI 对话',
      click: () => toggleAiChat(),
    },
    {
      label: '回到右下角',
      click: () => resetPetPosition(),
    },
    { type: 'separator' },
    {
      label: '隐藏桌宠（主程序再次唤起时恢复）',
      click: () => hidePet(),
    },
  ]);
  menu.popup({ window: win });
}

/** 按内容实际高度收紧交互窗口，并保持贴近桌宠。 */
function applyInteractiveWindowHeight(win, requestedHeight, visible) {
  if (!win || win.isDestroyed()) return;

  const petBounds = getPetBounds();
  const { workArea } = petBounds
    ? screen.getDisplayMatching(petBounds)
    : screen.getPrimaryDisplay();
  const maximumHeight = Math.max(
    INTERACTIVE_WINDOW_MIN_HEIGHT,
    workArea.height - BUBBLE_EDGE_MARGIN * 2,
  );
  const height = clamp(
    Math.ceil(Number(requestedHeight) || INTERACTIVE_WINDOW_DEFAULT_HEIGHT),
    INTERACTIVE_WINDOW_MIN_HEIGHT,
    maximumHeight,
  );
  const current = win.getBounds();
  if (current.height !== height) {
    // Windows 上 resizable:false 会让 setSize 被忽略（实测：420x320 调 setSize 纹丝不动，
    // setBounds 才生效），并且高度与位置必须一次提交，否则会先变高再挪位、出现中间帧。
    const position = petBounds
      ? calculateInteractiveWindowPosition(petBounds, INTERACTIVE_WINDOW_WIDTH, height)
      : { x: current.x, y: current.y };
    win.setBounds({
      x: position.x,
      y: position.y,
      width: INTERACTIVE_WINDOW_WIDTH,
      height,
    });
  }
  if (visible) showInteractiveWindow(win);
}

/** 按问答内容实际高度收紧窗口。 */
function handleAgentQuestionHeight(event, requestedHeight) {
  if (!isWindowSender(event, runtime.agentQuestionWindow)) return;
  applyInteractiveWindowHeight(
    runtime.agentQuestionWindow,
    requestedHeight,
    Boolean(runtime.latestAgentQuestion),
  );
}

/** 从问答窗口提交 Agent 答案。 */
function handleAgentQuestionAnswer(event, payload) {
  if (!isWindowSender(event, runtime.agentQuestionWindow)) throw new Error('无效的问答窗口来源');
  if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
  return runtime.ctx.answerAgentQuestion(payload);
}

/** 用户在问答窗口操作时停止自动回答倒计时。 */
function handleAgentQuestionSuppress(event, payload) {
  if (!isWindowSender(event, runtime.agentQuestionWindow)) throw new Error('无效的问答窗口来源');
  if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
  return runtime.ctx.suppressAgentQuestionAutoAnswer(payload);
}

/** 按目录选择内容实际高度收紧窗口。 */
function handleOutlineSelectionHeight(event, requestedHeight) {
  if (!isWindowSender(event, runtime.outlineSelectionWindow)) return;
  applyInteractiveWindowHeight(
    runtime.outlineSelectionWindow,
    requestedHeight,
    Boolean(getVisibleOutlineSelection()),
  );
}

/** 从目录选择窗口提交确认。 */
function handleOutlineSelectionConfirm(event, payload) {
  if (!isWindowSender(event, runtime.outlineSelectionWindow)) throw new Error('无效的目录选择窗口来源');
  if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
  return runtime.ctx.confirmOutlineSelection(payload);
}

/** 用户在目录选择窗口操作时停止自动确认倒计时。 */
function handleOutlineSelectionSuppress(event, payload) {
  if (!isWindowSender(event, runtime.outlineSelectionWindow)) throw new Error('无效的目录选择窗口来源');
  if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
  return runtime.ctx.suppressOutlineSelectionAutoConfirmation(payload);
}

/** “稍后处理”：停止倒计时并在本任务内不再自动弹出目录选择气泡。 */
function handleOutlineSelectionDismiss(event, payload) {
  if (!isWindowSender(event, runtime.outlineSelectionWindow)) return;
  const taskId = String(payload?.taskId || runtime.latestOutlineSelection?.task_id || '');
  if (!taskId) return;
  try {
    runtime.ctx?.suppressOutlineSelectionAutoConfirmation({ taskId });
  } catch (error) {
    runtime.ctx?.logger.error('稍后处理时停止自动确认失败:', error);
  }
  runtime.outlineSelectionDismissedTaskId = taskId;
  syncInteractiveWindows();
}

/** 按 AI 对话内容实际高度收紧窗口。 */
function handleAiChatHeight(event, requestedHeight) {
  if (!isWindowSender(event, runtime.aiChatWindow)) return;
  applyInteractiveWindowHeight(
    runtime.aiChatWindow,
    requestedHeight,
    isAiChatVisible(),
  );
}

/** 从 AI 对话窗口向 Agent 工作空间发送调整要求。 */
function handleAiChatSend(event, payload) {
  if (!isWindowSender(event, runtime.aiChatWindow)) throw new Error('无效的 AI 对话窗口来源');
  if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
  if (typeof runtime.ctx.sendAgentWorkspaceMessage !== 'function') {
    throw new Error('主程序版本不支持 AI 对话，请升级易标主程序');
  }
  const result = runtime.ctx.sendAgentWorkspaceMessage({
    workspaceId: String(payload?.workspaceId || ''),
    message: String(payload?.message || ''),
  });
  refreshAiChatWorkspace();
  return result;
}

/** 用户点击 AI 对话窗口的关闭按钮。 */
function handleAiChatClose(event) {
  if (!isWindowSender(event, runtime.aiChatWindow)) return;
  closeAiChat();
}

/** 注册简化版桌宠所需的主进程 IPC。 */
function registerIpc() {
  if (runtime.ipcRegistered) return;
  ipcMain.on(BUBBLE_WIDTH_CHANNEL, handleBubbleWidth);
  ipcMain.on(PET_READY_CHANNEL, handlePetReady);
  ipcMain.on(PET_DRAG_START_CHANNEL, handlePetDragStart);
  ipcMain.on(PET_DRAG_END_CHANNEL, handlePetDragEnd);
  ipcMain.on(PET_CLICK_CHANNEL, handlePetClick);
  ipcMain.on(PET_CONTEXT_MENU_CHANNEL, handlePetContextMenu);
  ipcMain.on(AGENT_QUESTION_HEIGHT_CHANNEL, handleAgentQuestionHeight);
  ipcMain.handle(AGENT_QUESTION_ANSWER_CHANNEL, handleAgentQuestionAnswer);
  ipcMain.handle(AGENT_QUESTION_SUPPRESS_CHANNEL, handleAgentQuestionSuppress);
  ipcMain.on(OUTLINE_SELECTION_HEIGHT_CHANNEL, handleOutlineSelectionHeight);
  ipcMain.on(OUTLINE_SELECTION_DISMISS_CHANNEL, handleOutlineSelectionDismiss);
  ipcMain.handle(OUTLINE_SELECTION_CONFIRM_CHANNEL, handleOutlineSelectionConfirm);
  ipcMain.handle(OUTLINE_SELECTION_SUPPRESS_CHANNEL, handleOutlineSelectionSuppress);
  ipcMain.on(AI_CHAT_HEIGHT_CHANNEL, handleAiChatHeight);
  ipcMain.on(AI_CHAT_CLOSE_CHANNEL, handleAiChatClose);
  ipcMain.handle(AI_CHAT_SEND_CHANNEL, handleAiChatSend);
  runtime.ipcRegistered = true;
}

/** 注销 IPC，避免插件重载后重复注册。 */
function unregisterIpc() {
  if (!runtime.ipcRegistered) return;
  ipcMain.removeListener(BUBBLE_WIDTH_CHANNEL, handleBubbleWidth);
  ipcMain.removeListener(PET_READY_CHANNEL, handlePetReady);
  ipcMain.removeListener(PET_DRAG_START_CHANNEL, handlePetDragStart);
  ipcMain.removeListener(PET_DRAG_END_CHANNEL, handlePetDragEnd);
  ipcMain.removeListener(PET_CLICK_CHANNEL, handlePetClick);
  ipcMain.removeListener(PET_CONTEXT_MENU_CHANNEL, handlePetContextMenu);
  ipcMain.removeListener(AGENT_QUESTION_HEIGHT_CHANNEL, handleAgentQuestionHeight);
  ipcMain.removeHandler(AGENT_QUESTION_ANSWER_CHANNEL);
  ipcMain.removeHandler(AGENT_QUESTION_SUPPRESS_CHANNEL);
  ipcMain.removeListener(OUTLINE_SELECTION_HEIGHT_CHANNEL, handleOutlineSelectionHeight);
  ipcMain.removeListener(OUTLINE_SELECTION_DISMISS_CHANNEL, handleOutlineSelectionDismiss);
  ipcMain.removeHandler(OUTLINE_SELECTION_CONFIRM_CHANNEL);
  ipcMain.removeHandler(OUTLINE_SELECTION_SUPPRESS_CHANNEL);
  ipcMain.removeListener(AI_CHAT_HEIGHT_CHANNEL, handleAiChatHeight);
  ipcMain.removeListener(AI_CHAT_CLOSE_CHANNEL, handleAiChatClose);
  ipcMain.removeHandler(AI_CHAT_SEND_CHANNEL);
  runtime.ipcRegistered = false;
}

/** 找到承载插件管理页面的主程序窗口。 */
function findHostWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow;

  return BrowserWindow.getAllWindows().find((win) => (
    !win.isDestroyed() && !win.isAlwaysOnTop()
  )) || null;
}

/** 创建承载静态 logo 的桌宠窗口：整窗可点击，无穿透逻辑。 */
function createPetWindow(ctx) {
  const position = getInitialPosition();
  const win = ctx.createWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('move', handlePetWindowMove);
  // 正常路径由渲染层 notifyReady 触发显示；渲染层异常时这里兜底，避免桌宠永远不出现。
  win.webContents.on('did-finish-load', () => {
    if (runtime.petWindow !== win) return;
    setTimeout(() => {
      if (runtime.petWindow !== win || win.isDestroyed()) return;
      if (runtime.petHiddenByUser || win.isVisible()) return;
      win.showInactive();
      win.moveTop();
    }, PET_SHOW_FALLBACK_MS);
  });
  win.on('closed', () => {
    if (runtime.petWindow !== win) return;
    stopPetDrag();
    runtime.petWindow = null;
    const bubbleWindow = runtime.bubbleWindow;
    if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();
    const questionWindow = runtime.agentQuestionWindow;
    if (questionWindow && !questionWindow.isDestroyed()) questionWindow.close();
    const selectionWindow = runtime.outlineSelectionWindow;
    if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
    const chatWindow = runtime.aiChatWindow;
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.close();
  });
  void win.loadFile(path.join(__dirname, 'pet.html'));
  return win;
}

/** 创建只读状态气泡窗口：全程鼠标穿透，不接收任何点击。 */
function createBubbleWindow(ctx) {
  const win = ctx.createWindow({
    width: BUBBLE_WINDOW_WIDTH,
    height: BUBBLE_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  // 气泡里没有任何可点元素，整窗永久穿透，无需动态开关。
  win.setIgnoreMouseEvents(true);
  win.webContents.on('did-finish-load', () => {
    if (runtime.bubbleWindow !== win) return;
    void win.webContents.insertCSS(SIMPLE_OVERRIDE_CSS);
    runtime.bubbleRendererReady = true;
    sendToWindow(win, STATUS_CHANNEL, runtime.latestStatus);
    sendToWindow(win, AGENT_QUESTION_CHANNEL, runtime.latestAgentQuestion);
    sendToWindow(win, OUTLINE_SELECTION_CHANNEL, getVisibleOutlineSelection());
    sendToWindow(win, AI_CHAT_CHANNEL, isAiChatVisible());
    if (runtime.petHiddenByUser) return;
    syncBubblePosition();
    win.showInactive();
  });
  win.on('closed', () => {
    if (runtime.bubbleWindow !== win) return;
    runtime.bubbleRendererReady = false;
    runtime.bubbleWindow = null;
  });
  void win.loadFile(path.join(__dirname, 'bubble.html'));
  return win;
}

/** 创建承载交互气泡的透明置顶窗口，加载完成后回调补发状态。 */
function createInteractiveWindow(ctx, htmlFile, onFinishLoad, onClosed) {
  const win = ctx.createWindow({
    width: INTERACTIVE_WINDOW_WIDTH,
    height: INTERACTIVE_WINDOW_DEFAULT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  // did-finish-load 由 Electron 主进程保证触发，显示与补发状态都不依赖渲染层主动上报。
  win.webContents.on('did-finish-load', () => {
    void win.webContents.insertCSS(SIMPLE_OVERRIDE_CSS);
    onFinishLoad(win);
  });
  win.on('closed', () => onClosed(win));
  void win.loadFile(path.join(__dirname, htmlFile));
  return win;
}

/** 懒创建问答窗口，无提问时不占用渲染进程。 */
function ensureAgentQuestionWindow() {
  if (runtime.agentQuestionWindow && !runtime.agentQuestionWindow.isDestroyed()) {
    return runtime.agentQuestionWindow;
  }
  if (!runtime.ctx) return null;
  runtime.agentQuestionRendererReady = false;
  runtime.agentQuestionWindow = createInteractiveWindow(
    runtime.ctx,
    'agent-question.html',
    (win) => {
      if (runtime.agentQuestionWindow !== win) return;
      runtime.agentQuestionRendererReady = true;
      sendToWindow(win, AGENT_QUESTION_CHANNEL, runtime.latestAgentQuestion);
      if (runtime.latestAgentQuestion) showInteractiveWindow(win);
    },
    (win) => {
      if (runtime.agentQuestionWindow !== win) return;
      runtime.agentQuestionRendererReady = false;
      runtime.agentQuestionWindow = null;
    },
  );
  return runtime.agentQuestionWindow;
}

/** 懒创建目录选择窗口，无待确认目录时不占用渲染进程。 */
function ensureOutlineSelectionWindow() {
  if (runtime.outlineSelectionWindow && !runtime.outlineSelectionWindow.isDestroyed()) {
    return runtime.outlineSelectionWindow;
  }
  if (!runtime.ctx) return null;
  runtime.outlineSelectionRendererReady = false;
  runtime.outlineSelectionWindow = createInteractiveWindow(
    runtime.ctx,
    'outline-selection.html',
    (win) => {
      if (runtime.outlineSelectionWindow !== win) return;
      runtime.outlineSelectionRendererReady = true;
      sendToWindow(win, OUTLINE_SELECTION_CHANNEL, runtime.latestOutlineSelection);
      if (getVisibleOutlineSelection()) showInteractiveWindow(win);
    },
    (win) => {
      if (runtime.outlineSelectionWindow !== win) return;
      runtime.outlineSelectionRendererReady = false;
      runtime.outlineSelectionWindow = null;
    },
  );
  return runtime.outlineSelectionWindow;
}

/** 懒创建 AI 对话窗口，未打开时不占用渲染进程。 */
function ensureAiChatWindow() {
  if (runtime.aiChatWindow && !runtime.aiChatWindow.isDestroyed()) {
    return runtime.aiChatWindow;
  }
  if (!runtime.ctx) return null;
  runtime.aiChatRendererReady = false;
  runtime.aiChatWindow = createInteractiveWindow(
    runtime.ctx,
    'ai-chat.html',
    (win) => {
      if (runtime.aiChatWindow !== win) return;
      runtime.aiChatRendererReady = true;
      publishAiChatState();
      if (isAiChatVisible()) showInteractiveWindow(win);
    },
    (win) => {
      if (runtime.aiChatWindow !== win) return;
      runtime.aiChatRendererReady = false;
      runtime.aiChatWindow = null;
    },
  );
  return runtime.aiChatWindow;
}

/** 清理插件持有的窗口、订阅和计时器。 */
function cleanupRuntime() {
  clearTerminalTimer();
  clearTransientNoticeTimer();
  clearAiChatRefreshTimer();
  stopPetDrag();
  unregisterIpc();

  runtime.latestAgentQuestion = null;
  runtime.petHiddenByUser = false;
  if (runtime.unsubscribeTask) {
    runtime.unsubscribeTask();
    runtime.unsubscribeTask = null;
  }
  if (runtime.unsubscribeAgentQuestion) {
    runtime.unsubscribeAgentQuestion();
    runtime.unsubscribeAgentQuestion = null;
  }
  if (runtime.unsubscribeWorkspaceChat) {
    runtime.unsubscribeWorkspaceChat();
    runtime.unsubscribeWorkspaceChat = null;
  }
  if (runtime.unsubscribeWorkspacesChanged) {
    runtime.unsubscribeWorkspacesChanged();
    runtime.unsubscribeWorkspacesChanged = null;
  }
  if (runtime.hostWindow && !runtime.hostWindow.isDestroyed()) {
    runtime.hostWindow.removeListener('closed', handleHostWindowClosed);
  }
  runtime.hostWindow = null;

  const questionWindow = runtime.agentQuestionWindow;
  runtime.agentQuestionWindow = null;
  runtime.agentQuestionRendererReady = false;
  if (questionWindow && !questionWindow.isDestroyed()) questionWindow.close();

  const selectionWindow = runtime.outlineSelectionWindow;
  runtime.outlineSelectionWindow = null;
  runtime.outlineSelectionRendererReady = false;
  runtime.latestOutlineSelection = null;
  runtime.outlineSelectionDismissedTaskId = null;
  if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();

  const chatWindow = runtime.aiChatWindow;
  runtime.aiChatWindow = null;
  runtime.aiChatRendererReady = false;
  runtime.aiChatOpen = false;
  runtime.aiChatWorkspace = null;
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.close();

  const bubbleWindow = runtime.bubbleWindow;
  runtime.bubbleWindow = null;
  runtime.bubbleRendererReady = false;
  runtime.bubblePillWidth = BUBBLE_WINDOW_WIDTH;
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();

  const petWindow = runtime.petWindow;
  runtime.petWindow = null;
  if (petWindow && !petWindow.isDestroyed()) petWindow.close();

  runtime.ctx = null;
  runtime.latestStatus = createIdleStatus();
}

/** 主程序窗口关闭时同步清理桌宠，避免插件窗口阻止应用退出。 */
function handleHostWindowClosed() {
  cleanupRuntime();
}

module.exports = {
  /** 激活插件并建立任务状态通信。 */
  async activate(ctx) {
    cleanupRuntime();
    runtime.ctx = ctx;
    runtime.latestStatus = createIdleStatus();
    runtime.hostWindow = findHostWindow();
    runtime.petWindow = createPetWindow(ctx);
    runtime.bubbleWindow = createBubbleWindow(ctx);

    registerIpc();
    if (runtime.hostWindow) {
      runtime.hostWindow.once('closed', handleHostWindowClosed);
    }

    publishLatestActiveOrIdle();
    runtime.unsubscribeTask = ctx.onTaskEvent(handleTaskEvent);
    runtime.unsubscribeAgentQuestion = ctx.onAgentQuestion(handleAgentQuestion);
    if (typeof ctx.onAgentWorkspaceChatEvent === 'function') {
      runtime.unsubscribeWorkspaceChat = ctx.onAgentWorkspaceChatEvent(handleWorkspaceChatEvent);
    }
    if (typeof ctx.onAgentWorkspacesChanged === 'function') {
      runtime.unsubscribeWorkspacesChanged = ctx.onAgentWorkspacesChanged(handleWorkspacesChanged);
    }
    publishAgentQuestion(ctx.getPendingAgentQuestion());
    restorePendingOutlineSelection();
    ctx.logger.info('易标桌宠（简化版）已启用');
  },

  /** 接收主程序宿主事件：open-ai-chat 打开 AI 对话框。 */
  async onHostEvent(event) {
    if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
    if (event === 'open-ai-chat') {
      showPet();
      openAiChat();
      return;
    }
    throw new Error(`未知的桌宠宿主事件: ${event}`);
  },

  /** 简化版没有皮肤与待机效果配置，保留空实现以兼容宿主调用。 */
  async onConfigChange() {},

  /** 停用插件并释放全部运行资源。 */
  async deactivate() {
    const logger = runtime.ctx?.logger;
    cleanupRuntime();
    logger?.info('易标桌宠（简化版）已停用');
  },
};
