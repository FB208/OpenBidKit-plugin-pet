const { contextBridge, ipcRenderer } = require('electron');

const STATUS_CHANNEL = 'plugin:openbidkit-pet:status';
const MOTION_CHANNEL = 'plugin:openbidkit-pet:motion';
const DRAG_START_CHANNEL = 'plugin:openbidkit-pet:drag-start';
const DRAG_MOVE_CHANNEL = 'plugin:openbidkit-pet:drag-move';
const DRAG_END_CHANNEL = 'plugin:openbidkit-pet:drag-end';
const DRAG_CANCEL_CHANNEL = 'plugin:openbidkit-pet:drag-cancel';
const DRAG_PRESENTATION_CHANNEL = 'plugin:openbidkit-pet:drag-presentation';
const DRAG_PREVIEW_CHANNEL = 'plugin:openbidkit-pet:drag-preview';

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

  /** 订阅悬浮窗口拖动方向，并返回取消订阅函数。 */
  onMotion(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petStatus.onMotion callback must be a function');
    }
    const listener = (_event, motion) => callback(motion);
    ipcRenderer.on(MOTION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(MOTION_CHANNEL, listener);
  },

  /** 订阅拖动预览显隐状态，并返回取消订阅函数。 */
  onDragPresentation(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petStatus.onDragPresentation callback must be a function');
    }
    const listener = (_event, presentation) => callback(presentation);
    ipcRenderer.on(DRAG_PRESENTATION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DRAG_PRESENTATION_CHANNEL, listener);
  },
});

contextBridge.exposeInMainWorld('petWindow', {
  /** 开始从角色本体拖动桌宠窗口。 */
  startDrag() {
    ipcRenderer.send(DRAG_START_CHANNEL);
  },

  /** 发送固定桌宠窗口内的指针位移。 */
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
});

contextBridge.exposeInMainWorld('petDragPreview', {
  /** 订阅固定透明画布中的角色位置。 */
  onChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('petDragPreview.onChange callback must be a function');
    }
    const listener = (_event, preview) => callback(preview);
    ipcRenderer.on(DRAG_PREVIEW_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DRAG_PREVIEW_CHANNEL, listener);
  },
});