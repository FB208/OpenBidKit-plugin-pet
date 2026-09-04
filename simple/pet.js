(() => {
const logoElement = document.getElementById('petLogo');
const CLICK_MOVEMENT_THRESHOLD = 3;

let pointerId = null;
let pointerOrigin = null;
let dragging = false;

/** 结束当前指针交互：位移足够小算点击，否则只是收尾拖动。 */
function finishPointer(event, cancelled) {
  if (pointerId === null || event.pointerId !== pointerId) return;
  if (logoElement.hasPointerCapture(pointerId)) {
    logoElement.releasePointerCapture(pointerId);
  }

  const moved = pointerOrigin
    ? Math.hypot(event.screenX - pointerOrigin.x, event.screenY - pointerOrigin.y)
    : 0;
  pointerId = null;
  pointerOrigin = null;

  if (dragging) {
    dragging = false;
    window.petWindow.endDrag();
  }
  if (!cancelled && moved < CLICK_MOVEMENT_THRESHOLD) {
    window.petWindow.click();
  }
}

logoElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || pointerId !== null) return;
  pointerId = event.pointerId;
  pointerOrigin = { x: event.screenX, y: event.screenY };
  dragging = true;
  logoElement.setPointerCapture(pointerId);
  // 主进程按光标绝对坐标移动窗口，渲染层不参与坐标计算。
  window.petWindow.startDrag();
});

logoElement.addEventListener('pointerup', (event) => finishPointer(event, false));
logoElement.addEventListener('pointercancel', (event) => finishPointer(event, true));

logoElement.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.petWindow.contextMenu();
});

// logo 解码完成后再显示窗口，避免透明窗口先亮出一块空白。
logoElement.decode()
  .catch(() => undefined)
  .then(() => window.petWindow.notifyReady());

})();
