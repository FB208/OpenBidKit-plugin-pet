const { contextBridge, ipcRenderer } = require('electron');

const STATUS_CHANNEL = 'plugin:openbidkit-pet:status';
const PET_READY_CHANNEL = 'plugin:openbidkit-pet:pet-ready';
const PET_DRAG_START_CHANNEL = 'plugin:openbidkit-pet:pet-drag-start';
const PET_DRAG_END_CHANNEL = 'plugin:openbidkit-pet:pet-drag-end';
const PET_CLICK_CHANNEL = 'plugin:openbidkit-pet:pet-click';
const PET_CONTEXT_MENU_CHANNEL = 'plugin:openbidkit-pet:pet-context-menu';
const AGENT_QUESTION_CHANNEL = 'plugin:openbidkit-pet:agent-question';
const AGENT_QUESTION_HEIGHT_CHANNEL = 'plugin:openbidkit-pet:agent-question-height';
const AGENT_QUESTION_ANSWER_CHANNEL = 'plugin:openbidkit-pet:agent-question-answer';
const AGENT_QUESTION_SUPPRESS_CHANNEL = 'plugin:openbidkit-pet:agent-question-suppress';
const OUTLINE_SELECTION_CHANNEL = 'plugin:openbidkit-pet:outline-selection';
const OUTLINE_SELECTION_HEIGHT_CHANNEL = 'plugin:openbidkit-pet:outline-selection-height';
const OUTLINE_SELECTION_CONFIRM_CHANNEL = 'plugin:openbidkit-pet:outline-selection-confirm';
const OUTLINE_SELECTION_SUPPRESS_CHANNEL = 'plugin:openbidkit-pet:outline-selection-suppress';
const OUTLINE_SELECTION_DISMISS_CHANNEL = 'plugin:openbidkit-pet:outline-selection-dismiss';
const AI_CHAT_CHANNEL = 'plugin:openbidkit-pet:ai-chat';
const AI_CHAT_HEIGHT_CHANNEL = 'plugin:openbidkit-pet:ai-chat-height';
const AI_CHAT_SEND_CHANNEL = 'plugin:openbidkit-pet:ai-chat-send';
const AI_CHAT_CLOSE_CHANNEL = 'plugin:openbidkit-pet:ai-chat-close';

contextBridge.exposeInMainWorld('petStatus', {
  /** 订阅桌宠状态变化，并返回取消订阅函数。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petStatus.onChange callback must be a function');
    }
    const listener = (_event, status) => callback(status);
    ipcRenderer.on(STATUS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(STATUS_CHANNEL, listener);
  },
});

contextBridge.exposeInMainWorld('petWindow', {
  /** 告知主进程 logo 已解码，可以显示窗口。 */
  notifyReady() {
    ipcRenderer.send(PET_READY_CHANNEL);
  },

  /** 按下 logo：主进程开始按光标绝对坐标移动窗口。 */
  startDrag() {
    ipcRenderer.send(PET_DRAG_START_CHANNEL);
  },

  /** 松开 logo：结束移动。 */
  endDrag() {
    ipcRenderer.send(PET_DRAG_END_CHANNEL);
  },

  /** 单击 logo：切换 AI 对话框开关。 */
  click() {
    ipcRenderer.send(PET_CLICK_CHANNEL);
  },

  /** 右键 logo：弹出上下文菜单。 */
  contextMenu() {
    ipcRenderer.send(PET_CONTEXT_MENU_CHANNEL);
  },
});

contextBridge.exposeInMainWorld('petAgentQuestion', {
  /** 订阅当前 Agent 问题（无问题时为 null），并返回取消订阅函数。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petAgentQuestion.onChange callback must be a function');
    }
    const listener = (_event, question) => callback(question);
    ipcRenderer.on(AGENT_QUESTION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(AGENT_QUESTION_CHANNEL, listener);
  },

  /** 上报问答卡片的实际内容高度，供主进程收紧窗口。 */
  reportHeight(height) {
    ipcRenderer.send(AGENT_QUESTION_HEIGHT_CHANNEL, height);
  },

  /** 提交选中的选项（custom 选项需附带 custom_answer）。 */
  answer(payload) {
    return ipcRenderer.invoke(AGENT_QUESTION_ANSWER_CHANNEL, payload);
  },

  /** 用户主动操作后停止当前问题的自动回答倒计时。 */
  suppressAutoAnswer(payload) {
    return ipcRenderer.invoke(AGENT_QUESTION_SUPPRESS_CHANNEL, payload);
  },
});

contextBridge.exposeInMainWorld('petOutlineSelection', {
  /** 订阅当前一级目录选择状态（无待确认时为 null），并返回取消订阅函数。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petOutlineSelection.onChange callback must be a function');
    }
    const listener = (_event, selection) => callback(selection);
    ipcRenderer.on(OUTLINE_SELECTION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(OUTLINE_SELECTION_CHANNEL, listener);
  },

  /** 上报目录选择卡片的实际内容高度，供主进程收紧窗口。 */
  reportHeight(height) {
    ipcRenderer.send(OUTLINE_SELECTION_HEIGHT_CHANNEL, height);
  },

  /** 提交一级目录确认，payload 为 { taskId, items, selectedIds }。 */
  confirm(payload) {
    return ipcRenderer.invoke(OUTLINE_SELECTION_CONFIRM_CHANNEL, payload);
  },

  /** 用户主动操作后停止自动确认倒计时。 */
  suppressAutoConfirm(payload) {
    return ipcRenderer.invoke(OUTLINE_SELECTION_SUPPRESS_CHANNEL, payload);
  },

  /** 稍后处理：本任务内不再自动弹出目录选择气泡。 */
  dismiss(payload) {
    ipcRenderer.send(OUTLINE_SELECTION_DISMISS_CHANNEL, payload);
  },
});

contextBridge.exposeInMainWorld('petAiChat', {
  /** 订阅 AI 对话工作空间状态（对话框关闭时为 null，状态气泡收到的是可见布尔值）。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petAiChat.onChange callback must be a function');
    }
    const listener = (_event, workspace) => callback(workspace);
    ipcRenderer.on(AI_CHAT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(AI_CHAT_CHANNEL, listener);
  },

  /** 上报对话卡片的实际内容高度，供主进程收紧窗口。 */
  reportHeight(height) {
    ipcRenderer.send(AI_CHAT_HEIGHT_CHANNEL, height);
  },

  /** 向 Agent 工作空间发送调整要求，payload 为 { workspaceId, message }。 */
  send(payload) {
    return ipcRenderer.invoke(AI_CHAT_SEND_CHANNEL, payload);
  },

  /** 关闭 AI 对话框。 */
  close() {
    ipcRenderer.send(AI_CHAT_CLOSE_CHANNEL);
  },
});
