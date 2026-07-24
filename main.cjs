const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const PLUGIN_ID = 'openbidkit-pet';
const STATUS_CHANNEL = `plugin:${PLUGIN_ID}:status`;
const MOTION_CHANNEL = `plugin:${PLUGIN_ID}:motion`;
const DRAG_START_CHANNEL = `plugin:${PLUGIN_ID}:drag-start`;
const DRAG_MOVE_CHANNEL = `plugin:${PLUGIN_ID}:drag-move`;
const DRAG_END_CHANNEL = `plugin:${PLUGIN_ID}:drag-end`;
const PET_WINDOW_WIDTH = 160;
const PET_WINDOW_HEIGHT = 151;
const BUBBLE_WINDOW_WIDTH = 420;
const BUBBLE_WINDOW_HEIGHT = 136;
const BUBBLE_WINDOW_GAP = 8;
const BUBBLE_CONTENT_INSET = 32;
const BUBBLE_EDGE_MARGIN = 8;
const WINDOW_MARGIN = 24;
const POSITION_SAVE_DELAY_MS = 200;
const MOVE_IDLE_DELAY_MS = 140;

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
  bubbleWindow: null,
  petWindow: null,
  hostWindow: null,
  unsubscribeTask: null,
  terminalTimer: null,
  positionTimer: null,
  movementTimer: null,
  lastWindowX: null,
  dragState: null,
  dragIpcRegistered: false,
  petRendererReady: false,
  bubbleRendererReady: false,
  latestStatus: createIdleStatus(),
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


/** 向桌宠渲染页发送最新状态。 */
function publishStatus(status) {
  runtime.latestStatus = status;
  if (runtime.petRendererReady) {
    sendToWindow(runtime.petWindow, STATUS_CHANNEL, status);
  }
  if (runtime.bubbleRendererReady) {
    sendToWindow(runtime.bubbleWindow, STATUS_CHANNEL, status);
  }
}

/** 向渲染页发送窗口拖动方向。 */
function publishMotion(motion) {
  if (!runtime.petRendererReady) return;
  sendToWindow(runtime.petWindow, MOTION_CHANNEL, motion);
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

/** 计算独立状态气泡相对于桌宠窗口的位置。 */
function getBubbleWindowPosition() {
  const petWindow = runtime.petWindow;
  if (!petWindow || petWindow.isDestroyed()) return null;

  const petBounds = petWindow.getBounds();
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

/** 让独立状态气泡跟随桌宠窗口移动。 */
function syncBubbleWindowPosition() {
  const bubbleWindow = runtime.bubbleWindow;
  const position = getBubbleWindowPosition();
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !position) return;

  const [currentX, currentY] = bubbleWindow.getPosition();
  if (currentX === position.x && currentY === position.y) return;
  bubbleWindow.setPosition(position.x, position.y);
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

/** 记录拖动方向，并在停止移动后恢复任务状态动画。 */
function handlePetWindowMove() {
  syncBubbleWindowPosition();
  schedulePositionSave();

  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;
  const [x] = win.getPosition();
  const previousX = runtime.lastWindowX;
  runtime.lastWindowX = x;
  if (!Number.isFinite(previousX) || x === previousX) return;

  publishMotion({
    active: true,
    direction: x < previousX ? 'left' : 'right',
  });

  if (runtime.movementTimer) clearTimeout(runtime.movementTimer);
  runtime.movementTimer = setTimeout(() => {
    runtime.movementTimer = null;
    publishMotion({ active: false, direction: null });
  }, MOVE_IDLE_DELAY_MS);
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

/** 将渲染进程传入的坐标转换为可用数字。 */
function getPointerCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

/** 记录指针在桌宠窗口内的按下位置，供后续移动保持抓取点不变。 */
function handleDragStart(event, point) {
  if (!isPetWindowSender(event)) return;

  const pointerWindowX = getPointerCoordinate(point?.pointerWindowX);
  const pointerWindowY = getPointerCoordinate(point?.pointerWindowY);
  if (pointerWindowX === null || pointerWindowY === null) return;

  runtime.dragState = {
    pointerWindowX,
    pointerWindowY,
  };
}

/** 根据屏幕指针坐标移动桌宠窗口。 */
function handleDragMove(event, point) {
  if (!isPetWindowSender(event) || !runtime.dragState) return;

  const pointerScreenX = getPointerCoordinate(point?.pointerScreenX);
  const pointerScreenY = getPointerCoordinate(point?.pointerScreenY);
  if (pointerScreenX === null || pointerScreenY === null) return;

  const win = runtime.petWindow;
  if (!win || win.isDestroyed()) return;

  win.setPosition(
    Math.round(pointerScreenX - runtime.dragState.pointerWindowX),
    Math.round(pointerScreenY - runtime.dragState.pointerWindowY),
  );
}

/** 结束当前指针拖拽。 */
function handleDragEnd(event) {
  if (!isPetWindowSender(event)) return;
  runtime.dragState = null;
}

/** 注册桌宠指针拖拽所需的主进程 IPC。 */
function registerDragIpc() {
  if (runtime.dragIpcRegistered) return;
  ipcMain.on(DRAG_START_CHANNEL, handleDragStart);
  ipcMain.on(DRAG_MOVE_CHANNEL, handleDragMove);
  ipcMain.on(DRAG_END_CHANNEL, handleDragEnd);
  runtime.dragIpcRegistered = true;
}

/** 移除桌宠指针拖拽 IPC。 */
function unregisterDragIpc() {
  if (!runtime.dragIpcRegistered) return;
  ipcMain.removeListener(DRAG_START_CHANNEL, handleDragStart);
  ipcMain.removeListener(DRAG_MOVE_CHANNEL, handleDragMove);
  ipcMain.removeListener(DRAG_END_CHANNEL, handleDragEnd);
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

/** 创建桌宠透明悬浮窗口。 */
function createPetWindow(ctx) {
  const position = getInitialPosition(ctx);
  runtime.lastWindowX = position.x;
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
    movable: true,
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
  win.webContents.on('did-finish-load', () => {
    if (runtime.petWindow !== win) return;
    runtime.petRendererReady = true;
    sendToWindow(win, STATUS_CHANNEL, runtime.latestStatus);
  });
  win.once('ready-to-show', () => {
    if (runtime.petWindow === win && !win.isDestroyed()) {
      win.showInactive();
      win.moveTop();
      syncBubbleWindowPosition();
    }
  });
  win.on('closed', () => {
    if (runtime.petWindow !== win) return;
    runtime.dragState = null;
    runtime.petRendererReady = false;
    runtime.petWindow = null;
    const bubbleWindow = runtime.bubbleWindow;
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.close();
    }
  });
  void win.loadFile(path.join(__dirname, 'pet.html'));
  return win;
}

/** 创建不受桌宠尺寸约束的独立状态气泡窗口。 */
function createBubbleWindow(ctx) {
  const position = getBubbleWindowPosition();
  if (!position) throw new Error('无法确定桌宠状态气泡的位置');

  const win = ctx.createWindow({
    width: BUBBLE_WINDOW_WIDTH,
    height: BUBBLE_WINDOW_HEIGHT,
    x: position.x,
    y: position.y,
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
    if (runtime.bubbleWindow !== win) return;
    runtime.bubbleRendererReady = true;
    sendToWindow(win, STATUS_CHANNEL, runtime.latestStatus);
  });
  win.once('ready-to-show', () => {
    if (runtime.bubbleWindow === win && !win.isDestroyed()) {
      syncBubbleWindowPosition();
      win.showInactive();
      win.moveTop();
    }
  });
  win.on('closed', () => {
    if (runtime.bubbleWindow !== win) return;
    runtime.bubbleRendererReady = false;
    runtime.bubbleWindow = null;
  });
  void win.loadFile(path.join(__dirname, 'bubble.html'));
  return win;
}

/** 清理插件持有的窗口、订阅和计时器。 */
function cleanupRuntime() {
  clearTerminalTimer();
  unregisterDragIpc();
  runtime.dragState = null;

  if (runtime.positionTimer) {
    clearTimeout(runtime.positionTimer);
    runtime.positionTimer = null;
  }
  if (runtime.movementTimer) {
    clearTimeout(runtime.movementTimer);
    runtime.movementTimer = null;
  }
  runtime.lastWindowX = null;
  if (runtime.unsubscribeTask) {
    runtime.unsubscribeTask();
    runtime.unsubscribeTask = null;
  }
  if (runtime.hostWindow && !runtime.hostWindow.isDestroyed()) {
    runtime.hostWindow.removeListener('closed', handleHostWindowClosed);
  }
  runtime.hostWindow = null;

  const bubbleWindow = runtime.bubbleWindow;
  runtime.bubbleWindow = null;
  runtime.bubbleRendererReady = false;
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();

  const petWindow = runtime.petWindow;
  runtime.petWindow = null;
  runtime.petRendererReady = false;
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

    registerDragIpc();
    if (runtime.hostWindow) {
      runtime.hostWindow.once('closed', handleHostWindowClosed);
    }

    publishLatestActiveOrIdle();
    runtime.unsubscribeTask = ctx.onTaskEvent(handleTaskEvent);
    ctx.logger.info('易标桌宠已启用');
  },

  /** 停用插件并释放全部运行资源。 */
  async deactivate() {
    const logger = runtime.ctx?.logger;
    cleanupRuntime();
    logger?.info('易标桌宠已停用');
  },
};
