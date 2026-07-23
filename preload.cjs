const { contextBridge, ipcRenderer } = require('electron');

const STATUS_CHANNEL = 'plugin:openbidkit-pet:status';

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
