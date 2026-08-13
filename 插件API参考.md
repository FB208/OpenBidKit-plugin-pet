# 易标投标工具箱 - 插件 API 参考文档

> **版本：** v1.0.0  
> **更新日期：** 2026-07-23

本文档提供插件系统所有可用 API 的完整技术规范，包括类型定义、参数说明、返回值和使用示例。

---

## 目录

- [Main 进程 Context API](#main-进程-context-api)
  - [基础 API](#基础-api)
  - [任务进度 API](#任务进度-api)
  - [Agent 问答 API](#agent-问答-api)
  - [配置存储 API](#配置存储-api)
  - [窗口管理 API](#窗口管理-api)
  - [日志 API](#日志-api)
- [配置窗口 API](#配置窗口-api)
- [权限系统](#权限系统)
- [类型定义](#类型定义)
- [错误处理](#错误处理)

---

## Main 进程 Context API

插件的 `main.cjs` 中 `activate(ctx)` 方法接收一个 `context` 对象，根据插件声明的权限暴露不同的 API。

### 基础 API

#### `ctx.app`

**类型：** `Electron.App`（只读）

**说明：** Electron 应用实例，可用于获取路径、版本等信息。

**权限要求：** 无（所有插件可用）

**示例：**

```javascript
const userDataPath = ctx.app.getPath('userData');
const appVersion = ctx.app.getVersion();
const appName = ctx.app.getName();

console.log(`应用版本: ${appVersion}`);
console.log(`数据目录: ${userDataPath}`);
```

**常用方法：**

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `getPath(name)` | `string` | 获取特殊目录路径（'userData', 'temp', 'appData'等） |
| `getVersion()` | `string` | 获取应用版本号 |
| `getName()` | `string` | 获取应用名称 |
| `getLocale()` | `string` | 获取系统语言 |

---

#### `ctx.ipcMain`

**类型：** `Electron.IpcMain`

**说明：** IPC 主进程通信实例，插件可以注册自己的 IPC 通道。

**权限要求：** 无（所有插件可用）

**示例：**

```javascript
// 注册 IPC 通道
ctx.ipcMain.handle('plugin:demo:getData', async (event, arg) => {
  return { success: true, data: arg };
});

// 发送消息到渲染进程（需要窗口引用）
someWindow.webContents.send('plugin:demo:update', { value: 100 });
```

**注意事项：**
- 通道名称建议使用 `plugin:<plugin-id>:<action>` 格式，避免冲突
- 不要注册与主程序冲突的通道名
- 插件卸载时需要手动移除监听器

---

### 任务进度 API

#### `ctx.getActiveTasks()`

**权限要求：** `task:read`

**类型签名：**

```typescript
getActiveTasks(): Task[]
```

**返回值：** `Task[]` - 当前运行中的任务列表

**说明：** 获取所有正在运行的后台任务（技术方案生成、查重、废标检查等）。

**Task 结构：**

```typescript
interface Task {
  task_id: string;               // 任务 ID
  type: string;                  // 任务类型
  status: 'running' | 'pausing' | 'paused' | 'success' | 'error';
  progress: number;              // 当前任务全流程累计进度 0-100
  progress_detail?: {
    mode: 'full' | 'single' | 'correction' | 'illustration' | 'illustration-generation';
    phase: string;               // 当前阶段代码
    phase_label: string;         // 当前阶段中文名称
    phase_progress: number;      // 当前阶段进度 0-100
    completed: number;
    total: number;
    step: string;                // 当前子步骤代码
    step_label: string;          // 当前子步骤说明
  };
  started_at: string;
  updated_at: string;
  // ... 其他任务相关字段
}
```

**示例：**

```javascript
const tasks = ctx.getActiveTasks();

console.log(`当前运行 ${tasks.length} 个任务`);

tasks.forEach(task => {
  console.log(`任务 ${task.task_id}: ${task.type} - ${task.progress}%`);
});
```

**使用场景：**
- 桌面宠物根据任务数量改变表情
- 进度看板统计任务状态
- 任务完成提醒插件

---

#### `ctx.onTaskEvent(callback)`

**权限要求：** `task:subscribe`

**类型签名：**

```typescript
onTaskEvent(callback: (event: TaskEvent) => void): () => void
```

**参数：**
- `callback`: 事件回调函数，接收 `TaskEvent` 对象

**返回值：** `() => void` - 取消订阅函数

**说明：** 订阅所有任务事件，实时接收任务进度更新。

**TaskEvent 结构：**

```typescript
interface TaskEvent {
  task: Task;                              // 任务信息
  technicalPlan?: TechnicalPlanState;      // 技术方案状态
  rejectionCheck?: RejectionCheckState;    // 废标检查状态
  duplicateCheck?: DuplicateCheckState;    // 查重状态
}
```

**示例：**

```javascript
let unsubscribe = null;

module.exports = {
  async activate(ctx) {
    unsubscribe = ctx.onTaskEvent((event) => {
      console.log('收到任务事件:', event.task.type);
      
      // 根据任务进度执行操作
      if (event.task.status === 'success') {
        console.log('任务完成！');
        // 发送通知或更新界面
      }
    });
  },
  
  async deactivate() {
    if (unsubscribe) {
      unsubscribe();
    }
  }
};
```

**注意事项：**
- 必须在 `deactivate()` 中调用返回的取消订阅函数，否则会内存泄漏
- 回调函数中的错误会被捕获并记录，不会影响其他订阅者
- 事件频率较高时建议做防抖处理

---

#### `ctx.getTechnicalPlanState()`

**权限要求：** `task:read`

**类型签名：**

```typescript
getTechnicalPlanState(): TechnicalPlanState | null
```

**返回值：** `TechnicalPlanState | null` - 技术方案工作区状态，无工作区时返回 null

**说明：** 获取当前技术方案的完整状态，包括大纲、正文、分析结果等。

**示例：**

```javascript
const state = ctx.getTechnicalPlanState();

if (state) {
  console.log('工作区路径:', state.workspacePath);
  console.log('大纲条目数:', state.outlineData?.outline?.length || 0);
  console.log('已生成正文数:', state.generatedSections?.length || 0);
}
```

---

#### `ctx.getDuplicateCheckState()`

**权限要求：** `task:read`

**类型签名：**

```typescript
getDuplicateCheckState(): DuplicateCheckState | null
```

**返回值：** `DuplicateCheckState | null` - 查重工作区状态

**说明：** 获取查重任务的状态，包括文档列表、查重结果等。

---

#### `ctx.getRejectionCheckState()`

**权限要求：** `task:read`

**类型签名：**

```typescript
getRejectionCheckState(): RejectionCheckState | null
```

**返回值：** `RejectionCheckState | null` - 废标检查工作区状态

**说明：** 获取废标检查任务的状态，包括检查项、检查结果等。

---

### Agent 问答 API

#### `ctx.getPendingAgentQuestion()`

读取当前进程中正在等待回答的 Agent 问题；没有问题时返回 `null`。

#### `ctx.onAgentQuestion(callback)`

订阅 Agent 问题状态。问题出现或自动回答状态变化时返回完整问题，问题被任一入口回答或任务结束时返回 `null`。返回值为取消订阅函数。

#### `ctx.answerAgentQuestion(payload)`

提交答案并恢复 Agent 执行：

```javascript
ctx.answerAgentQuestion({
  question_id: question.question_id,
  option_id: option.id,
  custom_answer: option.custom ? '具体要求' : undefined,
});
```

#### `ctx.suppressAgentQuestionAutoAnswer(payload)`

用户主动操作选项后，停止当前问题的自动回答倒计时，不修改全局自动回答设置。

---

### 配置存储 API

#### `ctx.store.get(key)`

**权限要求：** 无（所有插件可用）

**类型签名：**

```typescript
get(key: string): any | undefined
```

**参数：**
- `key`: 配置键名

**返回值：** 配置值，不存在时返回 `undefined`

**说明：** 读取插件专用配置。配置保存在 `userData/plugins/<plugin-id>/config.json`。

**示例：**

```javascript
const enabled = ctx.store.get('notificationEnabled');
const interval = ctx.store.get('updateInterval') || 5000;

console.log(`通知已${enabled ? '启用' : '禁用'}`);
```

---

#### `ctx.store.set(key, value)`

**权限要求：** 无（所有插件可用）

**类型签名：**

```typescript
set(key: string, value: any): boolean
```

**参数：**
- `key`: 配置键名
- `value`: 配置值（必须可 JSON 序列化）

**返回值：** `boolean` - 成功返回 true，失败返回 false

**说明：** 写入插件专用配置，数据会持久化到磁盘。

**示例：**

```javascript
// 保存配置
ctx.store.set('notificationEnabled', true);
ctx.store.set('updateInterval', 5000);
ctx.store.set('lastCheckTime', new Date().toISOString());

// 保存复杂对象
ctx.store.set('settings', {
  theme: 'dark',
  position: { x: 100, y: 200 },
  filters: ['type1', 'type2']
});
```

**注意事项：**
- `value` 必须可以被 `JSON.stringify()` 序列化
- 不要存储循环引用对象
- 不要存储函数、Symbol 等不可序列化的值
- 大量频繁写入会影响性能，建议做防抖

---

### 窗口管理 API

#### `ctx.createWindow(options)`

**权限要求：** `window:create`

**类型签名：**

```typescript
createWindow(options: BrowserWindowConstructorOptions): BrowserWindow
```

**参数：**
- `options`: Electron `BrowserWindowConstructorOptions` 对象

**返回值：** `BrowserWindow` - 窗口实例

**说明：** 创建独立窗口，常用于桌面宠物、悬浮工具等。

**示例：**

```javascript
// 创建透明悬浮窗口（桌宠）
const petWindow = ctx.createWindow({
  width: 200,
  height: 200,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  alwaysOnTop: true,      // 始终置顶
  skipTaskbar: true,      // 不显示在任务栏
  resizable: false,       // 不可调整大小
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
  },
});

// 加载 HTML
const path = require('path');
petWindow.loadFile(path.join(__dirname, 'pet.html'));

// 设置窗口位置
petWindow.setPosition(100, 100);

// 窗口事件
petWindow.on('closed', () => {
  console.log('窗口已关闭');
});
```

**常用配置：**

```javascript
// 普通工具窗口
{
  width: 800,
  height: 600,
  minWidth: 400,
  minHeight: 300,
  title: '插件工具',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
  },
}

// 桌面宠物窗口
{
  width: 200,
  height: 200,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
}

// 通知窗口
{
  width: 320,
  height: 120,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,
  show: false,
}
```

**注意事项：**
- 窗口必须在 `deactivate()` 中关闭，避免内存泄漏
- 透明窗口在某些系统上可能有性能问题
- `alwaysOnTop` 窗口不要遮挡主程序界面

---

### 日志 API

#### `ctx.logger.info(...args)`

**权限要求：** 无（所有插件可用）

**类型签名：**

```typescript
info(...args: any[]): void
```

**说明：** 输出信息日志，日志会带上 `[plugin:<plugin-id>]` 前缀。

**示例：**

```javascript
ctx.logger.info('插件已启动');
ctx.logger.info('配置已加载:', config);
ctx.logger.info('任务完成，耗时:', elapsed, 'ms');
```

**输出示例：**
```
[plugin:desktop-pet] 插件已启动
[plugin:desktop-pet] 配置已加载: { enabled: true }
```

---

#### `ctx.logger.warn(...args)`

**权限要求：** 无（所有插件可用）

**类型签名：**

```typescript
warn(...args: any[]): void
```

**说明：** 输出警告日志。

**示例：**

```javascript
ctx.logger.warn('配置文件不存在，使用默认配置');
ctx.logger.warn('任务队列已满');
```

---

#### `ctx.logger.error(...args)`

**权限要求：** 无（所有插件可用）

**类型签名：**

```typescript
error(...args: any[]): void
```

**说明：** 输出错误日志。

**示例：**

```javascript
ctx.logger.error('激活失败:', error);
ctx.logger.error('文件读取失败:', error.message);
```

---

## 配置窗口 API

插件配置窗口（`config-ui/index.html`）中可以使用主程序注入的 `window.pluginConfig` API。

### `window.pluginConfig.get(key)`

**类型签名：**

```typescript
get(key: string): Promise<any>
```

**参数：**
- `key`: 配置键名

**返回值：** `Promise<any>` - 配置值

**说明：** 异步读取插件配置。

**示例（配置窗口中）：**

```javascript
// 加载配置
async function loadConfig() {
  const enabled = await window.pluginConfig.get('notificationEnabled');
  const interval = await window.pluginConfig.get('updateInterval');
  
  document.getElementById('notificationEnabled').checked = enabled;
  document.getElementById('updateInterval').value = interval || 5000;
}

loadConfig();
```

---

### `window.pluginConfig.set(key, value)`

**类型签名：**

```typescript
set(key: string, value: any): Promise<boolean>
```

**参数：**
- `key`: 配置键名
- `value`: 配置值

**返回值：** `Promise<boolean>` - 成功返回 true

**说明：** 异步保存插件配置。插件处于启用状态且模块暴露了 `onConfigChange(change)` 时，保存成功后主程序会立即调用该钩子。

**示例（配置窗口中）：**

```javascript
// 保存配置
document.getElementById('saveBtn').addEventListener('click', async () => {
  const enabled = document.getElementById('notificationEnabled').checked;
  const interval = document.getElementById('updateInterval').value;
  
  await window.pluginConfig.set('notificationEnabled', enabled);
  await window.pluginConfig.set('updateInterval', Number(interval));
  
  alert('配置已保存');
});
```

**完整示例：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>插件配置</title>
</head>
<body>
  <h1>桌面宠物配置</h1>
  
  <label>
    <input type="checkbox" id="notificationEnabled">
    启用通知
  </label>
  
  <label>
    更新间隔（毫秒）:
    <input type="number" id="updateInterval" value="5000">
  </label>
  
  <button id="saveBtn">保存</button>
  
  <script>
    // 加载配置
    async function loadConfig() {
      const enabled = await window.pluginConfig.get('notificationEnabled');
      const interval = await window.pluginConfig.get('updateInterval');
      
      document.getElementById('notificationEnabled').checked = enabled || false;
      document.getElementById('updateInterval').value = interval || 5000;
    }
    
    // 保存配置
    document.getElementById('saveBtn').addEventListener('click', async () => {
      const enabled = document.getElementById('notificationEnabled').checked;
      const interval = Number(document.getElementById('updateInterval').value);
      
      await window.pluginConfig.set('notificationEnabled', enabled);
      await window.pluginConfig.set('updateInterval', interval);
      
      alert('配置已保存');
    });
    
    loadConfig();
  </script>
</body>
</html>
```

---

## 权限系统

插件必须在 `manifest.json` 中声明所需权限，主程序根据权限决定暴露哪些 API。

### 可用权限列表

| 权限 | 说明 | 提供的 API |
|------|------|-----------|
| `task:read` | 读取任务状态 | `getActiveTasks()`, `getTechnicalPlanState()`, `getDuplicateCheckState()`, `getRejectionCheckState()` |
| `task:subscribe` | 订阅任务事件 | `onTaskEvent()` |
| `agent:question` | 响应 Agent 问答 | `getPendingAgentQuestion()`, `onAgentQuestion()`, `answerAgentQuestion()`, `suppressAgentQuestionAutoAnswer()` |
| `window:create` | 创建独立窗口 | `createWindow()` |

### 无需权限的 API

以下 API 所有插件都可以使用，无需声明权限：

- `ctx.app` - Electron App 实例
- `ctx.ipcMain` - IPC 主进程通信
- `ctx.store` - 插件配置存储
- `ctx.logger` - 日志输出

### 权限声明示例

```json
{
  "id": "desktop-pet",
  "name": "桌面宠物",
  "permissions": [
    "task:read",
    "task:subscribe",
    "window:create"
  ]
}
```

### 权限检查

主程序在创建插件上下文时，根据权限决定暴露的 API：

```javascript
// pluginContext.cjs 内部逻辑（插件开发者无需关心）
function createPluginContext(app, pluginId, manifest, services) {
  const context = {
    app,
    ipcMain,
    store,
    logger,
  };
  
  // 根据权限暴露 API
  if (manifest.permissions.includes('task:read')) {
    context.getActiveTasks = () => services.taskService.getActiveTasks();
    // ...
  }
  
  if (manifest.permissions.includes('task:subscribe')) {
    context.onTaskEvent = (callback) => { /* ... */ };
  }
  
  if (manifest.permissions.includes('window:create')) {
    context.createWindow = (options) => new BrowserWindow(options);
  }
  
  return context;
}
```

---

## 类型定义

### PluginContext

```typescript
interface PluginContext {
  // 基础 API（所有插件可用）
  app: Electron.App;
  ipcMain: Electron.IpcMain;
  store: {
    get(key: string): any;
    set(key: string, value: any): boolean;
  };
  logger: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
  };
  
  // 任务 API（需要 task:read 权限）
  getActiveTasks?: () => Task[];
  getTechnicalPlanState?: () => TechnicalPlanState | null;
  getDuplicateCheckState?: () => DuplicateCheckState | null;
  getRejectionCheckState?: () => RejectionCheckState | null;
  
  // 事件 API（需要 task:subscribe 权限）
  onTaskEvent?: (callback: (event: TaskEvent) => void) => () => void;

  // Agent 问答 API
  getPendingAgentQuestion?: () => AgentQuestion | null;
  onAgentQuestion?: (callback: (question: AgentQuestion | null) => void) => () => void;
  answerAgentQuestion?: (payload: AgentQuestionAnswerPayload) => { success: boolean };
  suppressAgentQuestionAutoAnswer?: (payload: { question_id: string }) => { success: boolean };
  
  // 窗口 API（需要 window:create 权限）
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow;
}
```

### PluginModule

```typescript
interface PluginModule {
  /**
   * 插件启用时调用
   * @param ctx 插件上下文
   */
  activate(ctx: PluginContext): Promise<void> | void;

  /**
   * 配置页保存后调用（可选）
   */
  onConfigChange?(change: { key: string; value: any }): Promise<void> | void;
  
  /**
   * 插件停用时调用
   */
  deactivate(): Promise<void> | void;
}
```

### AgentQuestion

```typescript
interface AgentQuestionOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
  custom: boolean;
}

interface AgentQuestion {
  question_id: string;
  task_id: string;
  task_title: string;
  question: string;
  options: AgentQuestionOption[];
  asked_at: string;
  auto_answer_at?: string;
}

interface AgentQuestionAnswerPayload {
  question_id: string;
  option_id: string;
  custom_answer?: string;
}
```

### Task

```typescript
interface Task {
  task_id: string;
  type: string;
  status: 'running' | 'pausing' | 'paused' | 'success' | 'error';
  progress: number;           // 当前任务全流程累计进度 0-100
  progress_detail?: {
    mode: 'full' | 'single' | 'correction' | 'illustration' | 'illustration-generation';
    phase: string;
    phase_label: string;
    phase_progress: number;   // 当前阶段进度 0-100
    completed: number;
    total: number;
    step: string;
    step_label: string;
  };
  started_at: string;
  updated_at: string;
  // ... 其他字段根据任务类型不同
}
```

### TaskEvent

```typescript
interface TaskEvent {
  task: Task;
  technicalPlan?: TechnicalPlanState;
  rejectionCheck?: RejectionCheckState;
  duplicateCheck?: DuplicateCheckState;
}
```

---

## 错误处理

### 插件激活失败

如果 `activate()` 抛出错误或返回 rejected Promise，插件会保持未启用状态：

```javascript
module.exports = {
  async activate(ctx) {
    try {
      // 初始化逻辑
      const config = ctx.store.get('config');
      if (!config) {
        throw new Error('配置不存在，请先配置插件');
      }
      
      // 创建窗口
      this.window = ctx.createWindow({ /* ... */ });
      
    } catch (error) {
      ctx.logger.error('激活失败:', error);
      throw error;  // 重新抛出，主程序会捕获并显示错误
    }
  }
};
```

### 任务事件回调错误

事件回调中的错误会被主程序捕获并记录，不会影响其他订阅者：

```javascript
const unsubscribe = ctx.onTaskEvent((event) => {
  try {
    // 处理事件
    updateUI(event);
  } catch (error) {
    ctx.logger.error('事件处理失败:', error);
    // 错误会被捕获，不会导致退订
  }
});
```

### 配置读写错误

配置 API 失败时返回 `undefined` 或 `false`，不会抛出错误：

```javascript
// 读取失败返回 undefined
const value = ctx.store.get('key');
if (value === undefined) {
  ctx.logger.warn('配置不存在，使用默认值');
  value = defaultValue;
}

// 写入失败返回 false
const success = ctx.store.set('key', value);
if (!success) {
  ctx.logger.error('配置保存失败');
}
```

### 最佳实践

1. **总是使用 try-catch 包裹关键逻辑**

```javascript
async activate(ctx) {
  try {
    // 初始化逻辑
  } catch (error) {
    ctx.logger.error('激活失败:', error);
    // 清理已创建的资源
    this.cleanup();
    throw error;
  }
}
```

2. **在 deactivate 中清理所有资源**

```javascript
async deactivate() {
  try {
    // 取消订阅
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    
    // 关闭窗口
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    
    // 清理定时器
    if (this.timer) {
      clearInterval(this.timer);
    }
  } catch (error) {
    ctx.logger.error('清理失败:', error);
  }
}
```

3. **防止内存泄漏**

```javascript
// ❌ 错误：忘记取消订阅
async activate(ctx) {
  ctx.onTaskEvent((event) => {
    // 处理事件
  });
}

// ✅ 正确：保存取消订阅函数
async activate(ctx) {
  this.unsubscribe = ctx.onTaskEvent((event) => {
    // 处理事件
  });
}

async deactivate() {
  if (this.unsubscribe) {
    this.unsubscribe();
  }
}
```

---

## 完整示例

### 桌面宠物插件

```javascript
// main.cjs
const path = require('path');

let petWindow = null;
let unsubscribe = null;

module.exports = {
  async activate(ctx) {
    ctx.logger.info('桌面宠物插件启动');
    
    try {
      // 加载配置
      const config = ctx.store.get('config') || {
        x: 100,
        y: 100,
        enabled: true,
      };
      
      if (!config.enabled) {
        ctx.logger.info('插件已禁用');
        return;
      }
      
      // 创建宠物窗口
      petWindow = ctx.createWindow({
        width: 200,
        height: 200,
        x: config.x,
        y: config.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      
      petWindow.loadFile(path.join(__dirname, 'pet.html'));
      
      // 保存窗口位置
      petWindow.on('moved', () => {
        const [x, y] = petWindow.getPosition();
        ctx.store.set('config', { ...config, x, y });
      });
      
      // 订阅任务事件
      unsubscribe = ctx.onTaskEvent((event) => {
        const progress = event.task.progress;
        
        // 发送进度到窗口
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('task-progress', {
            type: event.task.type,
            progress,
          });
        }
        
        // 任务完成时显示庆祝动画
        if (event.task.status === 'success') {
          ctx.logger.info('任务完成！');
          if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('celebrate');
          }
        }
      });
      
      ctx.logger.info('桌面宠物已启动');
      
    } catch (error) {
      ctx.logger.error('启动失败:', error);
      throw error;
    }
  },
  
  async deactivate() {
    try {
      // 取消订阅
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      
      // 关闭窗口
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.close();
        petWindow = null;
      }
      
      console.log('[desktop-pet] 插件已停用');
    } catch (error) {
      console.error('[desktop-pet] 停用失败:', error);
    }
  }
};
```

---

## 附录

### 常见问题

**Q: 为什么我的插件无法访问任务 API？**

A: 检查 `manifest.json` 是否声明了 `task:read` 权限。插件只能访问已声明权限对应的 API。

**Q: 如何调试插件？**

A: 使用 `ctx.logger` 输出日志，日志会显示在主程序的开发者控制台中。

**Q: 插件可以访问文件系统吗？**

A: 可以，但建议只访问 `ctx.app.getPath('userData')` 目录下的文件。不要硬编码路径。

**Q: 插件可以使用 npm 包吗？**

A: 可以，在插件目录下 `npm install` 后，将 `node_modules` 包含在打包的 zip 中即可。

**Q: 如何在插件窗口中使用 IPC？**

A: 创建窗口时指定 preload 脚本，在 preload 中使用 `contextBridge` 暴露 API。

---

## 更新日志

- **v1.0.0** (2026-07-23) - 初始版本，包含所有核心 API

---

**相关文档：**
- [插件开发指南](./插件开发指南.md) - 快速上手和开发流程
- [插件管理执行方案](./插件管理执行方案.md) - 技术架构和实现细节
