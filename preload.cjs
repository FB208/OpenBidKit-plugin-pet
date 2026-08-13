const { contextBridge, ipcRenderer } = require('electron');

const STATUS_CHANNEL = 'plugin:openbidkit-pet:status';
const MOTION_CHANNEL = 'plugin:openbidkit-pet:motion';
const SKIN_CHANNEL = 'plugin:openbidkit-pet:skin';
const SKIN_READY_CHANNEL = 'plugin:openbidkit-pet:skin-ready';
const HOVER_CHANNEL = 'plugin:openbidkit-pet:hover';
const DRAG_START_CHANNEL = 'plugin:openbidkit-pet:drag-start';
const DRAG_MOVE_CHANNEL = 'plugin:openbidkit-pet:drag-move';
const DRAG_END_CHANNEL = 'plugin:openbidkit-pet:drag-end';
const DRAG_CANCEL_CHANNEL = 'plugin:openbidkit-pet:drag-cancel';
const DRAG_PREVIEW_CHANNEL = 'plugin:openbidkit-pet:drag-preview';
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
const AI_BUTTON_CLICK_CHANNEL = 'plugin:openbidkit-pet:ai-button-click';

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

  /** 订阅桌宠拖动动画状态，并返回取消订阅函数。 */
  onMotion(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petStatus.onMotion callback must be a function');
    }
    const listener = (_event, motion) => callback(motion);
    ipcRenderer.on(MOTION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(MOTION_CHANNEL, listener);
  },

  /** 订阅透明输入层转发的鼠标悬停状态。 */
  onHover(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petStatus.onHover callback must be a function');
    }
    const listener = (_event, hovered) => callback(hovered);
    ipcRenderer.on(HOVER_CHANNEL, listener);
    return () => ipcRenderer.removeListener(HOVER_CHANNEL, listener);
  },
});

contextBridge.exposeInMainWorld('petSkin', {
  /** 订阅皮肤变化，并返回取消订阅函数。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petSkin.onChange callback must be a function');
    }
    const listener = (_event, skin) => callback(skin);
    ipcRenderer.on(SKIN_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SKIN_CHANNEL, listener);
  },

  /** 告知主进程指定皮肤已完成解码并可安全显示。 */
  notifyReady(skinId) {
    ipcRenderer.send(SKIN_READY_CHANNEL, skinId);
  },
});

contextBridge.exposeInMainWorld('petWindow', {
  /** 开始记录固定输入窗口内的拖动。 */
  startDrag() {
    ipcRenderer.send(DRAG_START_CHANNEL);
  },

  /** 发送固定输入窗口内的指针位移。 */
  moveDrag(delta) {
    ipcRenderer.send(DRAG_MOVE_CHANNEL, delta);
  },

  /** 释放指针并提交最终位移。 */
  endDrag(delta) {
    ipcRenderer.send(DRAG_END_CHANNEL, delta);
  },

  /** 放弃被中断的拖动。 */
  cancelDrag() {
    ipcRenderer.send(DRAG_CANCEL_CHANNEL);
  },

  /** 转发鼠标是否位于角色命中区域。 */
  setHovered(hovered) {
    ipcRenderer.send(HOVER_CHANNEL, Boolean(hovered));
  },
});

contextBridge.exposeInMainWorld('petDragPreview', {
  /** 订阅固定视觉层中的角色与气泡位置。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petDragPreview.onChange callback must be a function');
    }
    const listener = (_event, preview) => callback(preview);
    ipcRenderer.on(DRAG_PREVIEW_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DRAG_PREVIEW_CHANNEL, listener);
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
  /** 订阅 AI 对话工作空间状态（对话框关闭时为 null，视觉层收到的是可见布尔值）。 */
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

contextBridge.exposeInMainWorld('petAiButton', {
  /** 点击 AI 按钮，切换对话框开关。 */
  click() {
    ipcRenderer.send(AI_BUTTON_CLICK_CHANNEL);
  },
});