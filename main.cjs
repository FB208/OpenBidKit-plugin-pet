const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PLUGIN_ID = 'openbidkit-pet';
const STATUS_CHANNEL = `plugin:${PLUGIN_ID}:status`;
const WINDOW_WIDTH = 180;
const WINDOW_HEIGHT = 212;
const WINDOW_MARGIN = 24;
const POSITION_SAVE_DELAY_MS = 200;

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
  petWindow: null,
  hostWindow: null,
  unsubscribeTask: null,
  terminalTimer: null,
  positionTimer: null,
  rendererReady: false,
  latestStatus: createIdleStatus(),
};

/** 创建空闲状态。 */
function createIdleStatus() {
  return {
    text: '当前无执行任务',
    tone: 'idle',
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

/** 将主程序任务转换为悬浮窗展示状态。 */
function createTaskStatus(task) {
  const label = getTaskLabel(task);
  const progress = normalizeProgress(task.progress);
  const base = {
    taskType: task.type,
    status: task.status,
    progress,
  };

  if (task.status === 'running') {
    return { ...base, text: `${label} · ${progress}%`, tone: 'running' };
  }
  if (task.status === 'pausing') {
    return { ...base, text: `${label} · 正在暂停`, tone: 'paused' };
  }
  if (task.status === 'paused') {
    return { ...base, text: `${label} · 已暂停`, tone: 'paused' };
  }
  if (task.status === 'success') {
    return { ...base, text: `${label} · 已完成`, tone: 'success' };
  }
  if (task.status === 'error') {
    return { ...base, text: `${label} · 执行失败`, tone: 'error' };
  }

  return { ...base, text: `${label} · ${progress}%`, tone: 'running' };
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

/** 向桌宠渲染页发送最新状态。 */
function publishStatus(status) {
  runtime.latestStatus = status;
  const win = runtime.petWindow;
  if (!runtime.rendererReady || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  win.webContents.send(STATUS_CHANNEL, status);
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
    x: workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - WINDOW_MARGIN,
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
  const win = ctx.createWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
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
  win.on('move', schedulePositionSave);
  win.webContents.on('did-finish-load', () => {
    runtime.rendererReady = true;
    publishStatus(runtime.latestStatus);
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.on('closed', () => {
    runtime.rendererReady = false;
    if (runtime.petWindow === win) runtime.petWindow = null;
  });
  void win.loadFile(path.join(__dirname, 'pet.html'));
  return win;
}

/** 清理插件持有的窗口、订阅和计时器。 */
function cleanupRuntime() {
  clearTerminalTimer();

  if (runtime.positionTimer) {
    clearTimeout(runtime.positionTimer);
    runtime.positionTimer = null;
  }
  if (runtime.unsubscribeTask) {
    runtime.unsubscribeTask();
    runtime.unsubscribeTask = null;
  }
  if (runtime.hostWindow && !runtime.hostWindow.isDestroyed()) {
    runtime.hostWindow.removeListener('closed', handleHostWindowClosed);
  }
  runtime.hostWindow = null;

  const win = runtime.petWindow;
  runtime.petWindow = null;
  runtime.rendererReady = false;
  if (win && !win.isDestroyed()) win.close();

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
