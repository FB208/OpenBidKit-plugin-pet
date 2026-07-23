const { contextBridge, ipcRenderer } = require('electron');

const STATUS_CHANNEL = 'plugin:openbidkit-pet:status';
const MOTION_CHANNEL = 'plugin:openbidkit-pet:motion';
const DRAG_START_CHANNEL = 'plugin:openbidkit-pet:drag-start';
const DRAG_MOVE_CHANNEL = 'plugin:openbidkit-pet:drag-move';
const DRAG_END_CHANNEL = 'plugin:openbidkit-pet:drag-end';

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
});

contextBridge.exposeInMainWorld('petWindow', {
  /** 开始从角色本体拖动桌宠窗口。 */
  startDrag(point) {
    ipcRenderer.send(DRAG_START_CHANNEL, point);
  },

  /** 按当前屏幕指针坐标移动桌宠窗口。 */
  moveDrag(point) {
    ipcRenderer.send(DRAG_MOVE_CHANNEL, point);
  },

  /** 结束桌宠窗口拖动。 */
  endDrag() {
    ipcRenderer.send(DRAG_END_CHANNEL);
  },
});
