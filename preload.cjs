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