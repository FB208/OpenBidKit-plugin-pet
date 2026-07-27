const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
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
const PET_WINDOW_WIDTH = 160;
const PET_WINDOW_HEIGHT = 151;
const PET_SPRITE_WIDTH = 132;
const PET_SPRITE_HEIGHT = 143;
const PET_SPRITE_INSET_X = Math.round((PET_WINDOW_WIDTH - PET_SPRITE_WIDTH) / 2);
const PET_SPRITE_INSET_Y = Math.round((PET_WINDOW_HEIGHT - PET_SPRITE_HEIGHT) / 2);
const BUBBLE_WINDOW_WIDTH = 420;
const BUBBLE_WINDOW_HEIGHT = 136;
const BUBBLE_WINDOW_GAP = 8;
const BUBBLE_CONTENT_INSET = 32;
const BUBBLE_EDGE_MARGIN = 8;
const WINDOW_MARGIN = 24;
const POSITION_SAVE_DELAY_MS = 200;
const DRAG_MOVEMENT_THRESHOLD = 2;
const EDGE_PATROL_IDLE_DELAY_MS = 10_000;
const EDGE_PATROL_FRAME_INTERVAL_MS = 16;
const EDGE_PATROL_SPEED_PX_PER_SECOND = 72;
const EDGE_PATROL_MAX_ELAPSED_MS = 120;

const TASK_LABELS = Object.freeze({
  'bid-section-extraction': '多标段识别',
  'bid-analysis': '招标文件解析',
  'outline-generation': '目录生成',
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
  petWindow: null,
  hostWindow: null,
  unsubscribeTask: null,
  terminalTimer: null,
  positionTimer: null,
  dragState: null,
  edgePatrolDelayTimer: null,
  edgePatrolFrameTimer: null,
  edgePatrolState: null,
  dragIpcRegistered: false,
  dragPreviewRendererReady: false,
  latestSkin: null,
  latestStatus: createIdleStatus(),
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

/** 计算所有显示器共同覆盖的固定透明画布。 */
function getVirtualDesktopBounds() {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map(({ bounds }) => bounds.x));
  const top = Math.min(...displays.map(({ bounds }) => bounds.y));
  const right = Math.max(...displays.map(({ bounds }) => bounds.x + bounds.width));
  const bottom = Math.max(...displays.map(({ bounds }) => bounds.y + bounds.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}


/** 向唯一视觉层发送最新任务状态。 */
function publishStatus(status) {
  runtime.latestStatus = status;
  if (runtime.dragPreviewRendererReady) {
    sendToWindow(runtime.dragPreviewWindow, STATUS_CHANNEL, status);
  }
  if (status?.tone === 'idle') {
    scheduleEdgePatrol();
  } else {
    stopEdgePatrol();
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
    stopEdgePatrol();
  } else {
    scheduleEdgePatrol();
  }
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

/** 处理主程序任务事件并更新展示状态。 */
function handleTaskEvent(event) {
  const task = event?.task;
  if (!task) return;

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

/** 计算首次显示位置，优先使用插件保存的坐标。 */
function getInitialPosition(ctx) {
  const savedPosition = ctx.store.get('windowPosition');
  if (Number.isFinite(savedPosition?.x) && Number.isFinite(savedPosition?.y)) {
    return { x: Math.round(savedPosition.x), y: Math.round(savedPosition.y) };
  }

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

/** 判断当前是否满足十秒待命巡边条件。 */
function canStartEdgePatrol() {
  const win = runtime.petWindow;
  return Boolean(
    runtime.latestStatus?.tone === 'idle'
    && !runtime.dragState
    && !runtime.latestHovered
    && win
    && !win.isDestroyed()
  );
}

/** 清理巡边启动倒计时。 */
function clearEdgePatrolDelay() {
  if (runtime.edgePatrolDelayTimer) {
    clearTimeout(runtime.edgePatrolDelayTimer);
    runtime.edgePatrolDelayTimer = null;
  }
}

/** 按角色可见区域计算当前显示器的巡边坐标。 */
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
  if (!state) return;
  state.segment = segment;
  state.target = getEdgePatrolTarget(segment, state);
  const animation = getEdgePatrolAnimation(segment);
  if (state.animation === animation) return;
  state.animation = animation;
  publishMotion({
    active: true,
    animation,
    source: 'edge-patrol',
  });
}

/** 移动巡边输入窗口并同步唯一视觉层。 */
function moveEdgePatrolWindow(x, y) {
  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const [currentX, currentY] = win.getPosition();
  if (currentX !== roundedX || currentY !== roundedY) {
    win.setPosition(roundedX, roundedY);
  }
  showDragPreview(roundedX, roundedY);
}

/** 按真实经过时间推进一次顺时针巡边。 */
function advanceEdgePatrol() {
  const state = runtime.edgePatrolState;
  if (!state) return;
  if (!canStartEdgePatrol()) {
    stopEdgePatrol();
    return;
  }

  const now = Date.now();
  const elapsedMs = Math.min(EDGE_PATROL_MAX_ELAPSED_MS, Math.max(0, now - state.lastTickAt));
  state.lastTickAt = now;
  let remainingDistance = EDGE_PATROL_SPEED_PX_PER_SECOND * elapsedMs / 1000;
  let transitionCount = 0;

  while (remainingDistance > 0 && transitionCount < 8) {
    const deltaX = state.target.x - state.x;
    const deltaY = state.target.y - state.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0.01) {
      activateEdgePatrolSegment(getNextEdgePatrolSegment(state.segment));
      transitionCount += 1;
      continue;
    }
    if (distance <= remainingDistance) {
      state.x = state.target.x;
      state.y = state.target.y;
      remainingDistance -= distance;
      activateEdgePatrolSegment(getNextEdgePatrolSegment(state.segment));
      transitionCount += 1;
      continue;
    }
    const ratio = remainingDistance / distance;
    state.x += deltaX * ratio;
    state.y += deltaY * ratio;
    remainingDistance = 0;
  }

  moveEdgePatrolWindow(state.x, state.y);
}

/** 从当前位置走向最近竖边并开始顺时针巡边。 */
function startEdgePatrol() {
  runtime.edgePatrolDelayTimer = null;
  if (!canStartEdgePatrol() || runtime.edgePatrolState) return;
  const win = runtime.petWindow;
  const [windowX, windowY] = win.getPosition();
  const { workArea } = screen.getDisplayMatching({
    x: windowX,
    y: windowY,
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
  });
  const bounds = getEdgePatrolTravelBounds(workArea);
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
  moveEdgePatrolWindow(x, y);
  const leftDistance = Math.abs(x - bounds.left);
  const rightDistance = Math.abs(bounds.right - x);
  activateEdgePatrolSegment(leftDistance <= rightDistance ? 'approach-left' : 'approach-right');
  runtime.edgePatrolFrameTimer = setInterval(advanceEdgePatrol, EDGE_PATROL_FRAME_INTERVAL_MS);
}

/** 停止巡边及倒计时，并恢复当前任务状态动作。 */
function stopEdgePatrol(options = {}) {
  clearEdgePatrolDelay();
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
  schedulePositionSave();
}

/** 在持续空闲且无人交互十秒后启动巡边。 */
function scheduleEdgePatrol() {
  clearEdgePatrolDelay();
  if (runtime.edgePatrolState || !canStartEdgePatrol()) return;
  runtime.edgePatrolDelayTimer = setTimeout(startEdgePatrol, EDGE_PATROL_IDLE_DELAY_MS);
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

/** 延迟保存窗口位置，避免拖动期间频繁写配置。 */
function schedulePositionSave() {
  if (!runtime.ctx || !runtime.petWindow || runtime.petWindow.isDestroyed()) return;
  if (runtime.positionTimer) clearTimeout(runtime.positionTimer);

  runtime.positionTimer = setTimeout(() => {
    runtime.positionTimer = null;
    const win = runtime.petWindow;
    if (!runtime.ctx || !win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    runtime.ctx.store.set('windowPosition', { x, y });
  }, POSITION_SAVE_DELAY_MS);
}

/** 输入窗口落位后同步固定画布位置并保存坐标。 */
function handlePetWindowMove() {
  if (!runtime.edgePatrolState) schedulePositionSave();
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

/** 在固定透明画布内更新角色和气泡位置。 */
function showDragPreview(windowX, windowY) {
  const previewWindow = runtime.dragPreviewWindow;
  if (!previewWindow || previewWindow.isDestroyed()) return;

  const previewBounds = previewWindow.getBounds();
  const bubblePosition = calculateBubbleWindowPosition({
    x: windowX,
    y: windowY,
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
  });
  runtime.latestDragPreview = {
    active: true,
    x: windowX - previewBounds.x + PET_SPRITE_INSET_X,
    y: windowY - previewBounds.y + PET_SPRITE_INSET_Y,
    bubbleX: bubblePosition.x - previewBounds.x,
    bubbleY: bubblePosition.y - previewBounds.y,
  };
  if (runtime.dragPreviewRendererReady) {
    sendToWindow(previewWindow, DRAG_PREVIEW_CHANNEL, runtime.latestDragPreview);
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

  stopEdgePatrol();
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
      schedulePositionSave();
    }
  }
  if (state.moving) publishMotion({ active: false, direction: null });
  scheduleEdgePatrol();
}

/** 指针捕获意外终止时将视觉层恢复到拖动起点。 */
function handleDragCancel(event) {
  if (!isPetWindowSender(event) || !runtime.dragState) return;
  const state = runtime.dragState;
  runtime.dragState = null;
  showDragPreview(state.windowX, state.windowY);
  if (state.moving) publishMotion({ active: false, direction: null });
  scheduleEdgePatrol();
}

/** 转发透明输入层的鼠标悬停状态。 */
function handlePetHover(event, hovered) {
  if (!isPetWindowSender(event)) return;
  publishHover(hovered);
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
  const position = getInitialPosition(ctx);
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
  });
  void win.loadFile(path.join(__dirname, 'drag-handle.html'));
  return win;
}
/** 创建始终可见、完全穿透鼠标的唯一桌宠视觉层。 */
function createDragPreviewWindow(ctx) {
  const bounds = getVirtualDesktopBounds();
  const win = ctx.createWindow({
    ...bounds,
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
  win.setIgnoreMouseEvents(true);
  win.webContents.on('did-finish-load', () => {
    if (runtime.dragPreviewWindow !== win) return;
    runtime.dragPreviewRendererReady = true;
    sendToWindow(win, SKIN_CHANNEL, runtime.latestSkin);
    sendToWindow(win, STATUS_CHANNEL, runtime.latestStatus);
    sendToWindow(win, HOVER_CHANNEL, runtime.latestHovered);
    if (runtime.latestDragPreview) {
      sendToWindow(win, DRAG_PREVIEW_CHANNEL, runtime.latestDragPreview);
    }
  });
  win.on('closed', () => {
    if (runtime.dragPreviewWindow !== win) return;
    runtime.dragPreviewRendererReady = false;
    runtime.dragPreviewWindow = null;
    const inputWindow = runtime.petWindow;
    if (inputWindow && !inputWindow.isDestroyed()) inputWindow.close();
  });
  void win.loadFile(path.join(__dirname, 'drag-preview.html'));
  return win;
}
/** 清理插件持有的窗口、订阅和计时器。 */
function cleanupRuntime() {
  clearTerminalTimer();
  unregisterDragIpc();
  runtime.dragState = null;
  stopEdgePatrol({ publishStopped: false });

  if (runtime.positionTimer) {
    clearTimeout(runtime.positionTimer);
    runtime.positionTimer = null;
  }
  runtime.latestDragPreview = null;
  runtime.latestHovered = false;
  runtime.latestSkin = null;
  if (runtime.unsubscribeTask) {
    runtime.unsubscribeTask();
    runtime.unsubscribeTask = null;
  }
  if (runtime.hostWindow && !runtime.hostWindow.isDestroyed()) {
    runtime.hostWindow.removeListener('closed', handleHostWindowClosed);
  }
  runtime.hostWindow = null;

  const visualWindow = runtime.dragPreviewWindow;
  runtime.dragPreviewWindow = null;
  runtime.dragPreviewRendererReady = false;
  if (visualWindow && !visualWindow.isDestroyed()) visualWindow.close();

  const inputWindow = runtime.petWindow;
  runtime.petWindow = null;
  if (inputWindow && !inputWindow.isDestroyed()) inputWindow.close();

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
    runtime.latestSkin = getConfiguredSkin(ctx);
    runtime.latestStatus = createIdleStatus();
    runtime.hostWindow = findHostWindow();
    runtime.petWindow = createPetWindow(ctx);
    runtime.dragPreviewWindow = createDragPreviewWindow(ctx);
    const [initialX, initialY] = runtime.petWindow.getPosition();
    showDragPreview(initialX, initialY);

    registerDragIpc();
    if (runtime.hostWindow) {
      runtime.hostWindow.once('closed', handleHostWindowClosed);
    }

    publishLatestActiveOrIdle();
    runtime.unsubscribeTask = ctx.onTaskEvent(handleTaskEvent);
    ctx.logger.info('易标桌宠已启用');
  },

  /** 配置页保存皮肤后，无需重启插件即可更新视觉层。 */
  async onConfigChange(change) {
    if (change?.key !== 'skinId' || !runtime.ctx) return;

    const skin = skinRegistry.getSkin(String(change.value));
    if (!skin) {
      throw new Error(`未注册的桌宠皮肤: ${change.value}`);
    }

    publishSkin(createSkinPresentation(skin));
    runtime.ctx.logger.info(`桌宠皮肤已切换: ${skin.id}`);
  },

  /** 停用插件并释放全部运行资源。 */
  async deactivate() {
    const logger = runtime.ctx?.logger;
    cleanupRuntime();
    logger?.info('易标桌宠已停用');
  },
};
