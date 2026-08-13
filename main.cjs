const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const effectRegistry = require('./effect-registry.js');
const skinRegistry = require('./skin-registry.js');

const PLUGIN_ID = 'openbidkit-pet';
const STATUS_CHANNEL = `plugin:${PLUGIN_ID}:status`;
const MOTION_CHANNEL = `plugin:${PLUGIN_ID}:motion`;
const SKIN_CHANNEL = `plugin:${PLUGIN_ID}:skin`;
const SKIN_READY_CHANNEL = `plugin:${PLUGIN_ID}:skin-ready`;
const DRAG_START_CHANNEL = `plugin:${PLUGIN_ID}:drag-start`;
const DRAG_MOVE_CHANNEL = `plugin:${PLUGIN_ID}:drag-move`;
const DRAG_END_CHANNEL = `plugin:${PLUGIN_ID}:drag-end`;
const DRAG_CANCEL_CHANNEL = `plugin:${PLUGIN_ID}:drag-cancel`;
const HOVER_CHANNEL = `plugin:${PLUGIN_ID}:hover`;
const DRAG_PREVIEW_CHANNEL = `plugin:${PLUGIN_ID}:drag-preview`;
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
const AI_BUTTON_CLICK_CHANNEL = `plugin:${PLUGIN_ID}:ai-button-click`;
const AI_HOVER_CHANNEL = `plugin:${PLUGIN_ID}:ai-hover`;
const ENABLED_EFFECT_IDS_CONFIG_KEY = 'enabledEffectIds';
const EDGE_PATROL_EFFECT_ID = 'edge-patrol';
const SLEEP_EFFECT_ID = 'sleeping';
const SLEEP_ANIMATION = 'sleeping';
const PET_WINDOW_WIDTH = 160;
const PET_WINDOW_HEIGHT = 151;
const PET_SPRITE_WIDTH = 132;
const PET_SPRITE_HEIGHT = 143;
const PET_SPRITE_INSET_X = Math.round((PET_WINDOW_WIDTH - PET_SPRITE_WIDTH) / 2);
const PET_SPRITE_INSET_Y = Math.round((PET_WINDOW_HEIGHT - PET_SPRITE_HEIGHT) / 2);
const VISUAL_WINDOW_OVERFLOW_X = Math.ceil(PET_WINDOW_WIDTH / 2);
const VISUAL_WINDOW_OVERFLOW_Y = Math.ceil(PET_WINDOW_HEIGHT / 2);
const BUBBLE_WINDOW_WIDTH = 420;
const BUBBLE_WINDOW_HEIGHT = 136;
const BUBBLE_WINDOW_GAP = 8;
const BUBBLE_CONTENT_INSET = 32;
const BUBBLE_EDGE_MARGIN = 8;
const INTERACTIVE_WINDOW_WIDTH = 420;
const INTERACTIVE_WINDOW_DEFAULT_HEIGHT = 320;
const INTERACTIVE_WINDOW_MIN_HEIGHT = 160;
const INTERACTIVE_WINDOW_GAP = 10;
const AI_CHAT_REFRESH_DELAY_MS = 300;
const TRANSIENT_NOTICE_DURATION_MS = 4000;
const WINDOW_MARGIN = 24;
const DRAG_MOVEMENT_THRESHOLD = 2;
const IDLE_EFFECT_DELAY_MS = 10_000;
const IDLE_EFFECT_DURATION_MS = 10 * 60 * 1_000;
const EDGE_PATROL_FRAME_INTERVAL_MS = 16;
const EDGE_PATROL_SPEED_PX_PER_SECOND = 40;
const EDGE_PATROL_MAX_ELAPSED_MS = 120;
const WINDOW_COORDINATE_MIN = -2_147_483_648;
const WINDOW_COORDINATE_MAX = 2_147_483_647;
const EDGE_PATROL_SEGMENTS = new Set([
  'approach-left',
  'approach-right',
  'left',
  'top',
  'right',
  'bottom',
]);

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
  dragPreviewWindow: null,
  agentQuestionWindow: null,
  outlineSelectionWindow: null,
  aiChatWindow: null,
  petWindow: null,
  hostWindow: null,
  unsubscribeTask: null,
  unsubscribeAgentQuestion: null,
  unsubscribeWorkspaceChat: null,
  terminalTimer: null,
  transientNoticeTimer: null,
  aiChatRefreshTimer: null,
  dragState: null,
  idleEffectDelayTimer: null,
  idleEffectDurationTimer: null,
  activeIdleEffectId: null,
  nextIdleEffectId: null,
  edgePatrolFrameTimer: null,
  edgePatrolState: null,
  displayEventsRegistered: false,
  dragIpcRegistered: false,
  dragPreviewRendererReady: false,
  agentQuestionRendererReady: false,
  outlineSelectionRendererReady: false,
  aiChatRendererReady: false,
  aiChatOpen: false,
  aiChatWorkspace: null,
  dragPreviewDisplayId: null,
  dragPreviewTargetBounds: null,
  enabledEffectIds: new Set(),
  latestSkin: null,
  latestStatus: createIdleStatus(),
  latestAgentQuestion: null,
  latestOutlineSelection: null,
  outlineSelectionDismissedTaskId: null,
  latestDragPreview: null,
  latestHovered: false,
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

/** 将已注册皮肤转换为视觉层所需的展示数据。 */
function createSkinPresentation(skin) {
  return {
    id: skin.id,
    name: skin.name,
    spriteSheet: skin.spriteSheet,
    atlas: skinRegistry.atlas,
  };
}

/** 读取当前配置对应的皮肤；首次使用时选择注册表默认项。 */
function getConfiguredSkin(ctx) {
  const storedSkinId = ctx.store.get('skinId');
  const skinId = storedSkinId === undefined
    ? skinRegistry.defaultSkinId
    : String(storedSkinId);
  const skin = skinRegistry.getSkin(skinId);
  if (!skin) {
    throw new Error(`未注册的桌宠皮肤: ${skinId}`);
  }
  return createSkinPresentation(skin);
}

/** 读取当前配置中已启用的桌宠效果。 */
function getConfiguredEffectIds(ctx) {
  return effectRegistry.resolveEnabledEffectIds(
    ctx.store.get(ENABLED_EFFECT_IDS_CONFIG_KEY),
  );
}

/** 判断指定桌宠效果当前是否启用。 */
function isEffectEnabled(effectId) {
  return runtime.enabledEffectIds.has(effectId);
}

/** 按注册顺序读取当前启用的待机效果。 */
function getEnabledIdleEffectIds() {
  return effectRegistry.effects
    .filter((effect) => isEffectEnabled(effect.id))
    .map((effect) => effect.id);
}

/** 读取指定效果之后的下一个已启用待机效果。 */
function getNextEnabledIdleEffectId(currentEffectId = null) {
  const enabledIds = getEnabledIdleEffectIds();
  if (enabledIds.length === 0) return null;
  if (!currentEffectId) return enabledIds[0];

  const currentIndex = effectRegistry.effects.findIndex(
    (effect) => effect.id === currentEffectId,
  );
  for (let offset = 1; offset <= effectRegistry.effects.length; offset += 1) {
    const candidate = effectRegistry.effects[
      (currentIndex + offset + effectRegistry.effects.length)
        % effectRegistry.effects.length
    ];
    if (isEffectEnabled(candidate.id)) return candidate.id;
  }
  return enabledIds[0];
}

/** 即时应用配置页提交的效果开关。 */
function applyEnabledEffects(value) {
  const effectIds = effectRegistry.resolveEnabledEffectIds(value);
  const activeEffectId = runtime.activeIdleEffectId;
  runtime.enabledEffectIds = new Set(effectIds);

  if (effectIds.length === 0) {
    runtime.nextIdleEffectId = null;
    stopIdleEffects({ preserveForResume: false });
    return effectIds;
  }

  if (activeEffectId && !isEffectEnabled(activeEffectId)) {
    const nextEffectId = getNextEnabledIdleEffectId(activeEffectId);
    stopIdleEffects({ preserveForResume: false });
    runtime.nextIdleEffectId = nextEffectId;
    scheduleIdleEffect();
    return effectIds;
  }

  if (!activeEffectId) {
    if (!isEffectEnabled(runtime.nextIdleEffectId)) {
      runtime.nextIdleEffectId = getNextEnabledIdleEffectId();
    }
    scheduleIdleEffect();
  }
  return effectIds;
}
/** 计算所有显示器工作区共同组成的虚拟桌面巡边范围。 */
function getVirtualDesktopWorkArea() {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map(({ workArea }) => workArea.x));
  const top = Math.min(...displays.map(({ workArea }) => workArea.y));
  const right = Math.max(...displays.map(({ workArea }) => workArea.x + workArea.width));
  const bottom = Math.max(...displays.map(({ workArea }) => workArea.y + workArea.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/** 计算当前桌宠所在显示器对应的局部透明视觉画布。 */
function getDragPreviewWindowLayout(petBounds) {
  const display = screen.getDisplayMatching(petBounds);
  const { bounds } = display;
  return {
    displayId: display.id,
    bounds: {
      x: bounds.x - VISUAL_WINDOW_OVERFLOW_X,
      y: bounds.y - VISUAL_WINDOW_OVERFLOW_Y,
      width: bounds.width + VISUAL_WINDOW_OVERFLOW_X * 2,
      height: bounds.height + VISUAL_WINDOW_OVERFLOW_Y * 2,
    },
  };
}

/** 判断两个窗口范围是否完全一致。 */
function areWindowBoundsEqual(left, right) {
  return Boolean(
    left
    && right
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
  );
}


/** 向唯一视觉层发送最新任务状态。 */
function publishStatus(status) {
  runtime.latestStatus = status;
  if (runtime.dragPreviewRendererReady) {
    sendToWindow(runtime.dragPreviewWindow, STATUS_CHANNEL, status);
  }
  if (status?.tone === 'idle') {
    scheduleIdleEffect();
  } else {
    stopIdleEffects();
  }
}

/** 向唯一视觉层发送当前皮肤。 */
function publishSkin(skin) {
  runtime.latestSkin = skin;
  if (!runtime.dragPreviewRendererReady) return;
  sendToWindow(runtime.dragPreviewWindow, SKIN_CHANNEL, skin);
}

/** 向唯一视觉层发送拖动动画状态。 */
function publishMotion(motion) {
  if (!runtime.dragPreviewRendererReady) return;
  sendToWindow(runtime.dragPreviewWindow, MOTION_CHANNEL, motion);
}

/** 向唯一视觉层发送鼠标悬停状态。 */
function publishHover(hovered) {
  runtime.latestHovered = Boolean(hovered);
  if (runtime.dragPreviewRendererReady) {
    sendToWindow(runtime.dragPreviewWindow, HOVER_CHANNEL, runtime.latestHovered);
  }
  if (runtime.latestHovered) {
    stopIdleEffects();
  } else {
    scheduleIdleEffect();
  }
}
/** 读取桌宠输入窗口当前的屏幕范围。 */
function getPetBounds() {
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return null;
  const [x, y] = win.getPosition();
  return { x, y, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT };
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
  positionInteractiveWindow(win);
  if (!win.isVisible()) win.showInactive();
  win.moveTop();
}

/** 隐藏交互窗口。 */
function hideInteractiveWindow(win) {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
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

/** 统一调度问答、目录选择与 AI 对话三个交互气泡的显隐与待机效果。 */
function syncInteractiveWindows() {
  const question = runtime.latestAgentQuestion;
  const selection = getVisibleOutlineSelection();
  const aiChatVisible = isAiChatVisible();

  if (runtime.dragPreviewRendererReady) {
    sendToWindow(runtime.dragPreviewWindow, AGENT_QUESTION_CHANNEL, question);
    sendToWindow(runtime.dragPreviewWindow, OUTLINE_SELECTION_CHANNEL, selection);
    sendToWindow(runtime.dragPreviewWindow, AI_CHAT_CHANNEL, aiChatVisible);
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

  if (question || selection || aiChatVisible) {
    stopIdleEffects();
  } else {
    scheduleIdleEffect();
  }
}

/** 拖动或巡边时让可见的交互气泡跟随桌宠。 */
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
  const current = workspaces.find(
    (workspace) => workspace.id === runtime.aiChatWorkspace?.id,
  ) || workspaces[0] || null;
  if (!current) {
    closeAiChat();
    showTransientNotice('当前没有可执行任务', '目录生成完成后可通过 AI 对话调整');
    return;
  }
  runtime.aiChatWorkspace = current;
  publishAiChatState();
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

/** 打开 AI 对话；无可用工作空间时用气泡短暂提示。 */
function openAiChat() {
  if (!runtime.ctx) return;
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
  if (!workspaces.length) {
    closeAiChat();
    showTransientNotice('当前没有可执行任务', '目录生成完成后可通过 AI 对话调整');
    return;
  }
  runtime.aiChatWorkspace = workspaces.find(
    (workspace) => workspace.id === runtime.aiChatWorkspace?.id,
  ) || workspaces[0];
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

/** AI 按钮点击：切换对话框开关。 */
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

/** 计算首次显示位置，固定为主屏幕工作区右下角，保证桌宠始终可见。 */
function getInitialPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - BUBBLE_WINDOW_WIDTH - WINDOW_MARGIN
      + Math.round((BUBBLE_WINDOW_WIDTH - PET_WINDOW_WIDTH) / 2),
    y: workArea.y + workArea.height - PET_WINDOW_HEIGHT - WINDOW_MARGIN,
  };
}
/** 将数值限制在指定闭区间。 */
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** 判断当前是否允许运行待机效果。 */
function canRunIdleEffect() {
  const win = runtime.petWindow;
  return Boolean(
    runtime.latestStatus?.tone === 'idle'
    && !runtime.latestAgentQuestion
    && !getVisibleOutlineSelection()
    && !isAiChatVisible()
    && !runtime.dragState
    && !runtime.latestHovered
    && win
    && !win.isDestroyed()
  );
}

/** 判断巡边效果当前是否可以继续运行。 */
function canStartEdgePatrol() {
  return runtime.activeIdleEffectId === EDGE_PATROL_EFFECT_ID
    && canRunIdleEffect();
}

/** 清理待机效果启动倒计时。 */
function clearIdleEffectDelay() {
  if (runtime.idleEffectDelayTimer) {
    clearTimeout(runtime.idleEffectDelayTimer);
    runtime.idleEffectDelayTimer = null;
  }
}

/** 清理当前待机效果的十分钟时段计时。 */
function clearIdleEffectDuration() {
  if (runtime.idleEffectDurationTimer) {
    clearTimeout(runtime.idleEffectDurationTimer);
    runtime.idleEffectDurationTimer = null;
  }
}
/** 判断二维坐标是否由两个有限数值组成。 */
function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

/** 判断显示器工作区是否可以安全参与巡边计算。 */
function isValidWorkArea(workArea) {
  return Boolean(
    isFinitePoint(workArea)
    && Number.isFinite(workArea?.width)
    && Number.isFinite(workArea?.height)
    && workArea.width > 0
    && workArea.height > 0
  );
}

/** 判断巡边范围是否完整且方向有效。 */
function isValidEdgePatrolBounds(bounds) {
  return Boolean(
    Number.isFinite(bounds?.left)
    && Number.isFinite(bounds?.top)
    && Number.isFinite(bounds?.right)
    && Number.isFinite(bounds?.bottom)
    && bounds.left <= bounds.right
    && bounds.top <= bounds.bottom
  );
}

/** 判断巡边状态能否继续参与位移计算。 */
function isValidEdgePatrolState(state) {
  return Boolean(
    state
    && isFinitePoint(state)
    && isValidEdgePatrolBounds(state.bounds)
    && EDGE_PATROL_SEGMENTS.has(state.segment)
    && isFinitePoint(state.target)
    && Number.isFinite(state.lastTickAt)
  );
}

/** 将窗口坐标转换为 Electron 可接收的 32 位整数。 */
function normalizeWindowCoordinate(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < WINDOW_COORDINATE_MIN || rounded > WINDOW_COORDINATE_MAX) return null;
  return rounded;
}

/** 记录巡边故障现场，保留 NaN、Infinity 等关键数值。 */
function reportEdgePatrolFailure(reason, error = null, details = null) {
  const state = runtime.edgePatrolState;
  const diagnostic = {
    reason,
    segment: state?.segment ?? null,
    position: state ? { x: state.x, y: state.y } : null,
    target: state?.target ?? null,
    bounds: state?.bounds ?? null,
    lastTickAt: state?.lastTickAt ?? null,
    details,
    error: error instanceof Error ? error.stack || error.message : error,
  };
  const serialized = JSON.stringify(diagnostic, (_key, value) => (
    typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
  ));
  runtime.ctx?.logger.error(`巡边动画状态异常，已安全停止并等待重新启动：${serialized}`);
}

/** 清除受污染的巡边状态，并按待命规则重新开始计时。 */
function recoverEdgePatrol(reason, error = null, details = null) {
  reportEdgePatrolFailure(reason, error, details);
  stopIdleEffects({ preserveForResume: false });
  runtime.nextIdleEffectId = isEffectEnabled(EDGE_PATROL_EFFECT_ID)
    ? EDGE_PATROL_EFFECT_ID
    : getNextEnabledIdleEffectId(EDGE_PATROL_EFFECT_ID);
  scheduleIdleEffect();
}
/** 按角色可见区域计算整个虚拟桌面的巡边坐标。 */
function getEdgePatrolTravelBounds(workArea) {
  return {
    left: workArea.x - PET_SPRITE_INSET_X,
    top: workArea.y - PET_SPRITE_INSET_Y,
    right: workArea.x + workArea.width - PET_SPRITE_INSET_X - PET_SPRITE_WIDTH,
    bottom: workArea.y + workArea.height - PET_SPRITE_INSET_Y - PET_SPRITE_HEIGHT,
  };
}

/** 读取巡边阶段对应的终点坐标。 */
function getEdgePatrolTarget(segment, state) {
  const { bounds } = state;
  if (segment === 'approach-left') return { x: bounds.left, y: state.y };
  if (segment === 'approach-right') return { x: bounds.right, y: state.y };
  if (segment === 'left') return { x: bounds.left, y: bounds.top };
  if (segment === 'top') return { x: bounds.right, y: bounds.top };
  if (segment === 'right') return { x: bounds.right, y: bounds.bottom };
  return { x: bounds.left, y: bounds.bottom };
}

/** 按顺时针方向切换到下一条屏幕边。 */
function getNextEdgePatrolSegment(segment) {
  if (segment === 'approach-left') return 'left';
  if (segment === 'approach-right') return 'right';
  if (segment === 'left') return 'top';
  if (segment === 'top') return 'right';
  if (segment === 'right') return 'bottom';
  return 'left';
}

/** 读取巡边阶段对应的角色动作。 */
function getEdgePatrolAnimation(segment) {
  if (segment === 'approach-left') return 'walking-left';
  if (segment === 'approach-right') return 'walking-right';
  if (segment === 'left') return 'climbing-up';
  if (segment === 'top') return 'hanging-right';
  if (segment === 'right') return 'climbing-down';
  return 'walking-left';
}

/** 激活巡边阶段并同步对应动作。 */
function activateEdgePatrolSegment(segment) {
  const state = runtime.edgePatrolState;
  if (
    !state
    || !EDGE_PATROL_SEGMENTS.has(segment)
    || !isFinitePoint(state)
    || !isValidEdgePatrolBounds(state.bounds)
  ) {
    return false;
  }
  const target = getEdgePatrolTarget(segment, state);
  if (!isFinitePoint(target)) return false;
  state.segment = segment;
  state.target = target;
  const animation = getEdgePatrolAnimation(segment);
  if (state.animation === animation) return true;
  state.animation = animation;
  publishMotion({
    active: true,
    animation,
    source: 'edge-patrol',
  });
  return true;
}

/** 移动巡边输入窗口并同步唯一视觉层。 */
function moveEdgePatrolWindow(x, y) {
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return false;
  const roundedX = normalizeWindowCoordinate(x);
  const roundedY = normalizeWindowCoordinate(y);
  if (roundedX === null || roundedY === null) {
    recoverEdgePatrol('窗口目标坐标不是有效整数', null, { x, y });
    return false;
  }

  try {
    const [currentX, currentY] = win.getPosition();
    if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
      recoverEdgePatrol('Electron 返回了无效窗口坐标', null, { currentX, currentY });
      return false;
    }
    if (currentX !== roundedX || currentY !== roundedY) {
      win.setPosition(roundedX, roundedY);
    }
    if (!showDragPreview(roundedX, roundedY)) return false;
    return true;
  } catch (error) {
    recoverEdgePatrol('Electron 窗口移动调用失败', error, { x: roundedX, y: roundedY });
    return false;
  }
}

/** 按真实经过时间推进一次顺时针巡边。 */
function advanceEdgePatrol() {
  const state = runtime.edgePatrolState;
  if (!state) return;
  if (!canStartEdgePatrol()) {
    stopIdleEffects();
    return;
  }
  if (!isValidEdgePatrolState(state)) {
    recoverEdgePatrol('推进前巡边状态无效');
    return;
  }

  const now = Date.now();
  const elapsedMs = Math.min(EDGE_PATROL_MAX_ELAPSED_MS, Math.max(0, now - state.lastTickAt));
  if (!Number.isFinite(elapsedMs)) {
    recoverEdgePatrol('巡边计时结果无效', null, { now });
    return;
  }
  state.lastTickAt = now;
  let remainingDistance = EDGE_PATROL_SPEED_PX_PER_SECOND * elapsedMs / 1000;
  let transitionCount = 0;

  while (remainingDistance > 0 && transitionCount < 8) {
    const deltaX = state.target.x - state.x;
    const deltaY = state.target.y - state.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance)) {
      recoverEdgePatrol('巡边距离计算结果无效', null, { deltaX, deltaY });
      return;
    }
    if (distance <= 0.01) {
      if (!activateEdgePatrolSegment(getNextEdgePatrolSegment(state.segment))) {
        recoverEdgePatrol('无法切换到下一巡边阶段');
        return;
      }
      transitionCount += 1;
      continue;
    }
    if (distance <= remainingDistance) {
      state.x = state.target.x;
      state.y = state.target.y;
      remainingDistance -= distance;
      if (!activateEdgePatrolSegment(getNextEdgePatrolSegment(state.segment))) {
        recoverEdgePatrol('无法切换到下一巡边阶段');
        return;
      }
      transitionCount += 1;
      continue;
    }
    const ratio = remainingDistance / distance;
    if (!Number.isFinite(ratio)) {
      recoverEdgePatrol('巡边位移比例无效', null, { remainingDistance, distance });
      return;
    }
    state.x += deltaX * ratio;
    state.y += deltaY * ratio;
    remainingDistance = 0;
  }

  if (!isFinitePoint(state)) {
    recoverEdgePatrol('推进后的巡边坐标无效');
    return;
  }
  moveEdgePatrolWindow(state.x, state.y);
}

/** 从当前位置走向最近竖边并开始顺时针巡边。 */
function startEdgePatrol() {
  if (!canStartEdgePatrol() || runtime.edgePatrolState) return;
  const win = runtime.petWindow;
  let windowX;
  let windowY;
  let workArea;
  try {
    [windowX, windowY] = win.getPosition();
    if (!Number.isFinite(windowX) || !Number.isFinite(windowY)) {
      recoverEdgePatrol('启动巡边时读取到无效窗口坐标', null, { windowX, windowY });
      return;
    }
    workArea = getVirtualDesktopWorkArea();
  } catch (error) {
    recoverEdgePatrol('启动巡边时读取窗口或虚拟桌面信息失败', error);
    return;
  }
  if (!isValidWorkArea(workArea)) {
    recoverEdgePatrol('启动巡边时读取到无效虚拟桌面工作区', null, { workArea });
    return;
  }
  const bounds = getEdgePatrolTravelBounds(workArea);
  if (!isValidEdgePatrolBounds(bounds)) {
    recoverEdgePatrol('虚拟桌面工作区无法容纳桌宠巡边', null, { workArea, bounds });
    return;
  }
  const x = clamp(windowX, bounds.left, bounds.right);
  const y = clamp(windowY, bounds.top, bounds.bottom);
  runtime.edgePatrolState = {
    bounds,
    x,
    y,
    segment: null,
    target: null,
    animation: null,
    lastTickAt: Date.now(),
  };
  const leftDistance = Math.abs(x - bounds.left);
  const rightDistance = Math.abs(bounds.right - x);
  if (!activateEdgePatrolSegment(leftDistance <= rightDistance ? 'approach-left' : 'approach-right')) {
    recoverEdgePatrol('无法初始化巡边阶段');
    return;
  }
  if (!moveEdgePatrolWindow(x, y)) return;
  runtime.edgePatrolFrameTimer = setInterval(advanceEdgePatrol, EDGE_PATROL_FRAME_INTERVAL_MS);
}

/** 停止巡边位移，并按需通知视觉层恢复状态动作。 */
function stopEdgePatrol(options = {}) {
  if (runtime.edgePatrolFrameTimer) {
    clearInterval(runtime.edgePatrolFrameTimer);
    runtime.edgePatrolFrameTimer = null;
  }
  const wasActive = Boolean(runtime.edgePatrolState);
  runtime.edgePatrolState = null;
  if (!wasActive) return;
  if (options.publishStopped !== false) {
    publishMotion({
      active: false,
      direction: null,
      source: 'edge-patrol',
    });
  }
}

/** 启动一个已启用的待机效果，并建立十分钟时段。 */
function startIdleEffect(effectId) {
  clearIdleEffectDelay();
  if (
    runtime.activeIdleEffectId
    || !effectId
    || !isEffectEnabled(effectId)
    || !canRunIdleEffect()
  ) {
    return;
  }

  runtime.activeIdleEffectId = effectId;
  runtime.nextIdleEffectId = effectId;
  if (effectId === EDGE_PATROL_EFFECT_ID) {
    startEdgePatrol();
    if (
      runtime.activeIdleEffectId !== effectId
      || !runtime.edgePatrolState
    ) {
      return;
    }
  } else if (effectId === SLEEP_EFFECT_ID) {
    publishMotion({
      active: true,
      animation: SLEEP_ANIMATION,
      source: 'idle-effect',
    });
  } else {
    runtime.activeIdleEffectId = null;
    throw new Error(`未实现的桌宠待机效果: ${effectId}`);
  }

  clearIdleEffectDuration();
  runtime.idleEffectDurationTimer = setTimeout(
    completeIdleEffectPeriod,
    IDLE_EFFECT_DURATION_MS,
  );
}

/** 完成当前十分钟时段，并立即切换到下一个已启用效果。 */
function completeIdleEffectPeriod() {
  runtime.idleEffectDurationTimer = null;
  const currentEffectId = runtime.activeIdleEffectId;
  if (!currentEffectId) return;

  const nextEffectId = getNextEnabledIdleEffectId(currentEffectId);
  if (!nextEffectId) {
    stopIdleEffects({ preserveForResume: false });
    return;
  }
  if (nextEffectId === currentEffectId) {
    runtime.idleEffectDurationTimer = setTimeout(
      completeIdleEffectPeriod,
      IDLE_EFFECT_DURATION_MS,
    );
    return;
  }

  stopIdleEffects({ preserveForResume: false });
  runtime.nextIdleEffectId = nextEffectId;
  if (canRunIdleEffect()) {
    startIdleEffect(nextEffectId);
  } else {
    scheduleIdleEffect();
  }
}

/** 十秒待命结束后启动轮换队列中的下一个效果。 */
function startScheduledIdleEffect() {
  runtime.idleEffectDelayTimer = null;
  if (runtime.activeIdleEffectId || !canRunIdleEffect()) return;
  const effectId = isEffectEnabled(runtime.nextIdleEffectId)
    ? runtime.nextIdleEffectId
    : getNextEnabledIdleEffectId();
  startIdleEffect(effectId);
}

/** 在持续空闲且无人交互十秒后启动待机效果。 */
function scheduleIdleEffect() {
  clearIdleEffectDelay();
  if (
    runtime.activeIdleEffectId
    || !canRunIdleEffect()
    || getEnabledIdleEffectIds().length === 0
  ) {
    return;
  }
  if (!isEffectEnabled(runtime.nextIdleEffectId)) {
    runtime.nextIdleEffectId = getNextEnabledIdleEffectId();
  }
  runtime.idleEffectDelayTimer = setTimeout(
    startScheduledIdleEffect,
    IDLE_EFFECT_DELAY_MS,
  );
}

/** 停止当前待机效果和全部计时器，并保留中断前的轮换位置。 */
function stopIdleEffects(options = {}) {
  clearIdleEffectDelay();
  clearIdleEffectDuration();
  const activeEffectId = runtime.activeIdleEffectId;
  const preserveForResume = options.preserveForResume !== false;
  if (preserveForResume && activeEffectId && isEffectEnabled(activeEffectId)) {
    runtime.nextIdleEffectId = activeEffectId;
  }
  runtime.activeIdleEffectId = null;

  if (activeEffectId === EDGE_PATROL_EFFECT_ID || runtime.edgePatrolState) {
    stopEdgePatrol(options);
    return;
  }
  if (activeEffectId === SLEEP_EFFECT_ID && options.publishStopped !== false) {
    publishMotion({
      active: false,
      direction: null,
      source: 'idle-effect',
    });
  }
}

/** 显示器布局变化后同步视觉画布，并保持当前巡边时段。 */
function handleDisplayConfigurationChanged() {
  const wasPatrolling = runtime.activeIdleEffectId === EDGE_PATROL_EFFECT_ID
    && Boolean(runtime.edgePatrolState);
  if (wasPatrolling) stopEdgePatrol();

  const win = runtime.petWindow;
  if (win && !win.isDestroyed()) {
    const [windowX, windowY] = win.getPosition();
    showDragPreview(windowX, windowY);
  }
  if (wasPatrolling) {
    runtime.ctx?.logger.info('显示器布局发生变化，视觉画布和巡边范围已重新计算');
    startEdgePatrol();
  } else if (!runtime.activeIdleEffectId) {
    scheduleIdleEffect();
  }
}
/** 注册影响巡边工作区的显示器事件。 */
function registerDisplayEvents() {
  if (runtime.displayEventsRegistered) return;
  screen.on('display-added', handleDisplayConfigurationChanged);
  screen.on('display-removed', handleDisplayConfigurationChanged);
  screen.on('display-metrics-changed', handleDisplayConfigurationChanged);
  runtime.displayEventsRegistered = true;
}

/** 移除显示器事件监听。 */
function unregisterDisplayEvents() {
  if (!runtime.displayEventsRegistered) return;
  screen.removeListener('display-added', handleDisplayConfigurationChanged);
  screen.removeListener('display-removed', handleDisplayConfigurationChanged);
  screen.removeListener('display-metrics-changed', handleDisplayConfigurationChanged);
  runtime.displayEventsRegistered = false;
}

/** 计算指定桌宠坐标对应的状态气泡位置。 */
function calculateBubbleWindowPosition(petBounds) {
  const { workArea } = screen.getDisplayMatching(petBounds);
  const minimumX = workArea.x + BUBBLE_EDGE_MARGIN;
  const maximumX = Math.max(
    minimumX,
    workArea.x + workArea.width - BUBBLE_WINDOW_WIDTH - BUBBLE_EDGE_MARGIN,
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

/** 输入窗口落位后同步固定画布位置。 */
function handlePetWindowMove() {
  if (runtime.dragState) return;

  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  showDragPreview(x, y);
}
/** 判断 IPC 是否来自当前桌宠窗口。 */
function isPetWindowSender(event) {
  const win = runtime.petWindow;
  return Boolean(
    win
    && !win.isDestroyed()
    && !win.webContents.isDestroyed()
    && event.sender === win.webContents
  );
}

/** 判断 IPC 是否来自当前桌宠视觉层。 */
function isDragPreviewWindowSender(event) {
  const win = runtime.dragPreviewWindow;
  return Boolean(
    win
    && !win.isDestroyed()
    && !win.webContents.isDestroyed()
    && event.sender === win.webContents
  );
}

/** 首张皮肤图集完成解码后再显示视觉层，避免启动闪烁。 */
function handleSkinReady(event, skinId) {
  if (!isDragPreviewWindowSender(event)) return;
  if (String(skinId) !== runtime.latestSkin?.id) return;

  const win = runtime.dragPreviewWindow;
  if (!win || win.isDestroyed() || win.isVisible()) return;
  win.showInactive();
  win.moveTop();
}

/** 将渲染进程提供的同一窗口内位移规范为整数像素。 */
function normalizeDragDelta(delta) {
  const x = Number(delta?.x);
  const y = Number(delta?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** 将唯一视觉画布切换到桌宠当前所在的显示器。 */
function syncDragPreviewWindowLayout(petBounds) {
  const previewWindow = runtime.dragPreviewWindow;
  if (!previewWindow || previewWindow.isDestroyed()) return null;

  const layout = getDragPreviewWindowLayout(petBounds);
  const needsUpdate = (
    runtime.dragPreviewDisplayId !== layout.displayId
    || !areWindowBoundsEqual(runtime.dragPreviewTargetBounds, layout.bounds)
  );
  if (needsUpdate) {
    previewWindow.setBounds(layout.bounds);
    previewWindow.moveTop();
    runtime.dragPreviewDisplayId = layout.displayId;
    runtime.dragPreviewTargetBounds = layout.bounds;
  }
  return previewWindow.getBounds();
}

/** 在当前显示器的局部透明画布内更新角色和气泡位置。 */
function showDragPreview(windowX, windowY) {
  const previewWindow = runtime.dragPreviewWindow;
  if (
    !previewWindow
    || previewWindow.isDestroyed()
    || !Number.isFinite(windowX)
    || !Number.isFinite(windowY)
  ) {
    return false;
  }

  try {
    const petBounds = {
      x: Math.round(windowX),
      y: Math.round(windowY),
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
    };
    const previewBounds = syncDragPreviewWindowLayout(petBounds);
    if (!previewBounds) return false;
    const bubblePosition = calculateBubbleWindowPosition(petBounds);
    runtime.latestDragPreview = {
      active: true,
      x: petBounds.x - previewBounds.x + PET_SPRITE_INSET_X,
      y: petBounds.y - previewBounds.y + PET_SPRITE_INSET_Y,
      bubbleX: bubblePosition.x - previewBounds.x,
      bubbleY: bubblePosition.y - previewBounds.y,
    };
    if (runtime.dragPreviewRendererReady) {
      sendToWindow(previewWindow, DRAG_PREVIEW_CHANNEL, runtime.latestDragPreview);
    }
    syncInteractiveWindowPositions();
    return true;
  } catch (error) {
    if (runtime.edgePatrolState) {
      recoverEdgePatrol('同步桌宠视觉画布失败', error, { windowX, windowY });
    } else {
      runtime.ctx?.logger.error('同步桌宠视觉画布失败:', error);
    }
    return false;
  }
}

/** 根据固定输入窗口内的指针位移更新唯一视觉层。 */
function updateDragPreview(delta) {
  const state = runtime.dragState;
  if (!state) return null;

  const target = {
    x: state.windowX + delta.x,
    y: state.windowY + delta.y,
  };
  const previousDirection = state.direction;
  if (delta.x !== state.deltaX) {
    state.direction = delta.x < state.deltaX ? 'left' : 'right';
  }
  const hasMoved = Math.hypot(delta.x, delta.y) >= DRAG_MOVEMENT_THRESHOLD;
  if (hasMoved && (!state.moving || state.direction !== previousDirection)) {
    publishMotion({ active: true, direction: state.direction });
  }
  state.moving = state.moving || hasMoved;
  state.deltaX = delta.x;
  state.deltaY = delta.y;
  showDragPreview(target.x, target.y);
  return target;
}

/** 记录拖动起点；按下但未移动时保持当前动画。 */
function handleDragStart(event) {
  if (!isPetWindowSender(event)) return;

  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;

  stopIdleEffects();
  const [windowX, windowY] = win.getPosition();
  runtime.dragState = {
    windowX,
    windowY,
    deltaX: 0,
    deltaY: 0,
    direction: 'right',
    moving: false,
  };
}

/** 仅移动固定画布内的视觉元素。 */
function handleDragMove(event, rawDelta) {
  if (!isPetWindowSender(event) || !runtime.dragState) return;
  const delta = normalizeDragDelta(rawDelta);
  if (!delta) return;
  updateDragPreview(delta);
}

/** 指针释放后一次性对齐透明输入窗口。 */
function handleDragEnd(event, rawDelta) {
  if (!isPetWindowSender(event) || !runtime.dragState) return;
  const delta = normalizeDragDelta(rawDelta);
  const state = runtime.dragState;
  runtime.dragState = null;

  const win = runtime.petWindow;
  if (delta) {
    const targetX = state.windowX + delta.x;
    const targetY = state.windowY + delta.y;
    showDragPreview(targetX, targetY);
    if (win && !win.isDestroyed()) {
      win.setPosition(targetX, targetY);
    }
  }
  if (state.moving) publishMotion({ active: false, direction: null });
  scheduleIdleEffect();
}

/** 指针捕获意外终止时将视觉层恢复到拖动起点。 */
function handleDragCancel(event) {
  if (!isPetWindowSender(event) || !runtime.dragState) return;
  const state = runtime.dragState;
  runtime.dragState = null;
  showDragPreview(state.windowX, state.windowY);
  if (state.moving) publishMotion({ active: false, direction: null });
  scheduleIdleEffect();
}

/** 转发透明输入层的鼠标悬停状态。 */
function handlePetHover(event, hovered) {
  if (!isPetWindowSender(event)) return;
  publishHover(hovered);
}

/** 判断 IPC 是否来自指定交互窗口。 */
function isWindowSender(event, win) {
  return Boolean(
    win
    && !win.isDestroyed()
    && !win.webContents.isDestroyed()
    && event.sender === win.webContents
  );
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
  if (win.getBounds().height !== height) {
    win.setSize(INTERACTIVE_WINDOW_WIDTH, height, false);
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

/** 用户点击气泡内的 AI 图标。 */
function handleAiButtonClick(event) {
  if (!isDragPreviewWindowSender(event)) return;
  toggleAiChat();
}

/** 悬停气泡内 AI 图标时临时恢复视觉层鼠标命中，离开后恢复整层穿透。 */
function handleAiHover(event, hovering) {
  if (!isDragPreviewWindowSender(event)) return;
  const win = runtime.dragPreviewWindow;
  if (!win || win.isDestroyed()) return;
  if (hovering) {
    win.setIgnoreMouseEvents(false);
  } else {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
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
/** 注册桌宠指针拖拽所需的主进程 IPC。 */
function registerDragIpc() {
  if (runtime.dragIpcRegistered) return;
  ipcMain.on(DRAG_START_CHANNEL, handleDragStart);
  ipcMain.on(DRAG_MOVE_CHANNEL, handleDragMove);
  ipcMain.on(DRAG_END_CHANNEL, handleDragEnd);
  ipcMain.on(DRAG_CANCEL_CHANNEL, handleDragCancel);
  ipcMain.on(HOVER_CHANNEL, handlePetHover);
  ipcMain.on(SKIN_READY_CHANNEL, handleSkinReady);
  ipcMain.on(AGENT_QUESTION_HEIGHT_CHANNEL, handleAgentQuestionHeight);
  ipcMain.handle(AGENT_QUESTION_ANSWER_CHANNEL, handleAgentQuestionAnswer);
  ipcMain.handle(AGENT_QUESTION_SUPPRESS_CHANNEL, handleAgentQuestionSuppress);
  ipcMain.on(OUTLINE_SELECTION_HEIGHT_CHANNEL, handleOutlineSelectionHeight);
  ipcMain.on(OUTLINE_SELECTION_DISMISS_CHANNEL, handleOutlineSelectionDismiss);
  ipcMain.handle(OUTLINE_SELECTION_CONFIRM_CHANNEL, handleOutlineSelectionConfirm);
  ipcMain.handle(OUTLINE_SELECTION_SUPPRESS_CHANNEL, handleOutlineSelectionSuppress);
  ipcMain.on(AI_CHAT_HEIGHT_CHANNEL, handleAiChatHeight);
  ipcMain.on(AI_CHAT_CLOSE_CHANNEL, handleAiChatClose);
  ipcMain.on(AI_BUTTON_CLICK_CHANNEL, handleAiButtonClick);
  ipcMain.on(AI_HOVER_CHANNEL, handleAiHover);
  ipcMain.handle(AI_CHAT_SEND_CHANNEL, handleAiChatSend);
  runtime.dragIpcRegistered = true;
}

/** 移除桌宠指针拖拽 IPC。 */
function unregisterDragIpc() {
  if (!runtime.dragIpcRegistered) return;
  ipcMain.removeListener(DRAG_START_CHANNEL, handleDragStart);
  ipcMain.removeListener(DRAG_MOVE_CHANNEL, handleDragMove);
  ipcMain.removeListener(DRAG_END_CHANNEL, handleDragEnd);
  ipcMain.removeListener(DRAG_CANCEL_CHANNEL, handleDragCancel);
  ipcMain.removeListener(HOVER_CHANNEL, handlePetHover);
  ipcMain.removeListener(SKIN_READY_CHANNEL, handleSkinReady);
  ipcMain.removeListener(AGENT_QUESTION_HEIGHT_CHANNEL, handleAgentQuestionHeight);
  ipcMain.removeHandler(AGENT_QUESTION_ANSWER_CHANNEL);
  ipcMain.removeHandler(AGENT_QUESTION_SUPPRESS_CHANNEL);
  ipcMain.removeListener(OUTLINE_SELECTION_HEIGHT_CHANNEL, handleOutlineSelectionHeight);
  ipcMain.removeListener(OUTLINE_SELECTION_DISMISS_CHANNEL, handleOutlineSelectionDismiss);
  ipcMain.removeHandler(OUTLINE_SELECTION_CONFIRM_CHANNEL);
  ipcMain.removeHandler(OUTLINE_SELECTION_SUPPRESS_CHANNEL);
  ipcMain.removeListener(AI_CHAT_HEIGHT_CHANNEL, handleAiChatHeight);
  ipcMain.removeListener(AI_CHAT_CLOSE_CHANNEL, handleAiChatClose);
  ipcMain.removeListener(AI_BUTTON_CLICK_CHANNEL, handleAiButtonClick);
  ipcMain.removeListener(AI_HOVER_CHANNEL, handleAiHover);
  ipcMain.removeHandler(AI_CHAT_SEND_CHANNEL);
  runtime.dragIpcRegistered = false;
}
/** 找到承载插件管理页面的主程序窗口。 */
function findHostWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow;

  return BrowserWindow.getAllWindows().find((win) => (
    !win.isDestroyed() && !win.isAlwaysOnTop()
  )) || null;
}

/** 创建只负责鼠标命中的透明输入窗口。 */
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
  win.once('ready-to-show', () => {
    if (runtime.petWindow === win && !win.isDestroyed()) {
      win.showInactive();
      win.moveTop();
    }
  });
  win.on('closed', () => {
    if (runtime.petWindow !== win) return;
    runtime.dragState = null;
    runtime.petWindow = null;
    const visualWindow = runtime.dragPreviewWindow;
    if (visualWindow && !visualWindow.isDestroyed()) visualWindow.close();
    const questionWindow = runtime.agentQuestionWindow;
    if (questionWindow && !questionWindow.isDestroyed()) questionWindow.close();
    const selectionWindow = runtime.outlineSelectionWindow;
    if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
    const chatWindow = runtime.aiChatWindow;
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.close();
  });
  void win.loadFile(path.join(__dirname, 'drag-handle.html'));
  return win;
}
/** 创建覆盖桌宠当前显示器、完全穿透鼠标的唯一视觉层。 */
function createDragPreviewWindow(ctx, petBounds) {
  const layout = getDragPreviewWindowLayout(petBounds);
  runtime.dragPreviewDisplayId = layout.displayId;
  runtime.dragPreviewTargetBounds = layout.bounds;
  const win = ctx.createWindow({
    ...layout.bounds,
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
  // forward 模式：整层穿透但转发 mousemove，气泡内 AI 图标悬停时临时恢复命中。
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('did-finish-load', () => {
    if (runtime.dragPreviewWindow !== win) return;
    runtime.dragPreviewRendererReady = true;
    sendToWindow(win, SKIN_CHANNEL, runtime.latestSkin);
    sendToWindow(win, STATUS_CHANNEL, runtime.latestStatus);
    sendToWindow(win, HOVER_CHANNEL, runtime.latestHovered);
    sendToWindow(win, AGENT_QUESTION_CHANNEL, runtime.latestAgentQuestion);
    sendToWindow(win, OUTLINE_SELECTION_CHANNEL, getVisibleOutlineSelection());
    sendToWindow(win, AI_CHAT_CHANNEL, isAiChatVisible());
    if (runtime.latestDragPreview) {
      sendToWindow(win, DRAG_PREVIEW_CHANNEL, runtime.latestDragPreview);
    }
  });
  win.on('closed', () => {
    if (runtime.dragPreviewWindow !== win) return;
    runtime.dragPreviewRendererReady = false;
    runtime.dragPreviewDisplayId = null;
    runtime.dragPreviewTargetBounds = null;
    runtime.dragPreviewWindow = null;
    const inputWindow = runtime.petWindow;
    if (inputWindow && !inputWindow.isDestroyed()) inputWindow.close();
  });
  void win.loadFile(path.join(__dirname, 'drag-preview.html'));
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
  win.webContents.on('did-finish-load', () => onFinishLoad(win));
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
  unregisterDragIpc();
  unregisterDisplayEvents();
  runtime.dragState = null;
  stopIdleEffects({ publishStopped: false, preserveForResume: false });

  runtime.latestDragPreview = null;
  runtime.latestHovered = false;
  runtime.latestSkin = null;
  runtime.latestAgentQuestion = null;
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
  if (runtime.hostWindow && !runtime.hostWindow.isDestroyed()) {
    runtime.hostWindow.removeListener('closed', handleHostWindowClosed);
  }
  runtime.hostWindow = null;

  const visualWindow = runtime.dragPreviewWindow;
  runtime.dragPreviewWindow = null;
  runtime.dragPreviewRendererReady = false;
  runtime.dragPreviewDisplayId = null;
  runtime.dragPreviewTargetBounds = null;
  if (visualWindow && !visualWindow.isDestroyed()) visualWindow.close();

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

  const inputWindow = runtime.petWindow;
  runtime.petWindow = null;
  if (inputWindow && !inputWindow.isDestroyed()) inputWindow.close();

  runtime.ctx = null;
  runtime.latestStatus = createIdleStatus();
  runtime.activeIdleEffectId = null;
  runtime.nextIdleEffectId = null;
  runtime.enabledEffectIds = new Set();
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
    runtime.enabledEffectIds = new Set(getConfiguredEffectIds(ctx));
    runtime.latestSkin = getConfiguredSkin(ctx);
    runtime.latestStatus = createIdleStatus();
    runtime.hostWindow = findHostWindow();
    runtime.petWindow = createPetWindow(ctx);
    const [initialX, initialY] = runtime.petWindow.getPosition();
    runtime.dragPreviewWindow = createDragPreviewWindow(ctx, {
      x: initialX,
      y: initialY,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
    });
    showDragPreview(initialX, initialY);

    registerDragIpc();
    registerDisplayEvents();
    if (runtime.hostWindow) {
      runtime.hostWindow.once('closed', handleHostWindowClosed);
    }

    publishLatestActiveOrIdle();
    runtime.unsubscribeTask = ctx.onTaskEvent(handleTaskEvent);
    runtime.unsubscribeAgentQuestion = ctx.onAgentQuestion(handleAgentQuestion);
    if (typeof ctx.onAgentWorkspaceChatEvent === 'function') {
      runtime.unsubscribeWorkspaceChat = ctx.onAgentWorkspaceChatEvent(handleWorkspaceChatEvent);
    }
    publishAgentQuestion(ctx.getPendingAgentQuestion());
    restorePendingOutlineSelection();
    ctx.logger.info('易标桌宠已启用');
  },

  /** 接收主程序宿主事件：open-ai-chat 打开 AI 对话框。 */
  async onHostEvent(event) {
    if (!runtime.ctx) throw new Error('桌宠插件尚未激活');
    if (event === 'open-ai-chat') {
      openAiChat();
      return;
    }
    runtime.ctx.logger.info(`忽略未知宿主事件: ${event}`);
  },

  /** 配置页保存后，无需重启插件即可更新皮肤或效果。 */
  async onConfigChange(change) {
    if (!runtime.ctx || !change) return;

    if (change.key === 'skinId') {
      const skin = skinRegistry.getSkin(String(change.value));
      if (!skin) {
        throw new Error(`未注册的桌宠皮肤: ${change.value}`);
      }

      publishSkin(createSkinPresentation(skin));
      runtime.ctx.logger.info(`桌宠皮肤已切换: ${skin.id}`);
      return;
    }

    if (change.key === ENABLED_EFFECT_IDS_CONFIG_KEY) {
      const effectIds = applyEnabledEffects(change.value);
      runtime.ctx.logger.info(`桌宠效果已更新: ${effectIds.join(', ') || '无'}`);
    }
  },

  /** 停用插件并释放全部运行资源。 */
  async deactivate() {
    const logger = runtime.ctx?.logger;
    cleanupRuntime();
    logger?.info('易标桌宠已停用');
  },
};
