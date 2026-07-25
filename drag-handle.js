(() => {
const handleElement = document.getElementById('dragHandle');

let activePointerId = null;
let pointerDragStart = null;

/** 计算指针相对固定输入窗口的位移。 */
function getPointerDragDelta(event) {
  if (!pointerDragStart) return { x: 0, y: 0 };
  return {
    x: event.clientX - pointerDragStart.x,
    y: event.clientY - pointerDragStart.y,
  };
}

/** 捕获主指针并开始拖动。 */
function handlePointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || activePointerId !== null) return;

  event.preventDefault();
  activePointerId = event.pointerId;
  pointerDragStart = { x: event.clientX, y: event.clientY };
  handleElement.dataset.dragging = 'true';
  handleElement.setPointerCapture?.(event.pointerId);
  window.petWindow.startDrag();
}

/** 转发固定输入窗口内的绝对位移。 */
function handlePointerMove(event) {
  if (activePointerId !== event.pointerId) return;
  window.petWindow.moveDrag(getPointerDragDelta(event));
}

/** 释放时提交位置，捕获中断时恢复原位。 */
function finishPointerDrag(event) {
  if (activePointerId !== event.pointerId) return;

  const pointerId = activePointerId;
  const shouldCommit = event.type === 'pointerup';
  const delta = getPointerDragDelta(event);
  activePointerId = null;
  pointerDragStart = null;
  delete handleElement.dataset.dragging;
  if (shouldCommit) {
    window.petWindow.endDrag(delta);
  } else {
    window.petWindow.cancelDrag();
  }

  if (
    event.type !== 'lostpointercapture'
    && handleElement.hasPointerCapture?.(pointerId)
  ) {
    handleElement.releasePointerCapture(pointerId);
  }
}

handleElement.addEventListener('pointerenter', () => window.petWindow.setHovered(true));
handleElement.addEventListener('pointerleave', () => window.petWindow.setHovered(false));
handleElement.addEventListener('pointerdown', handlePointerDown);
handleElement.addEventListener('pointermove', handlePointerMove);
handleElement.addEventListener('pointerup', finishPointerDrag);
handleElement.addEventListener('pointercancel', finishPointerDrag);
handleElement.addEventListener('lostpointercapture', finishPointerDrag);

window.addEventListener('beforeunload', () => {
  window.petWindow.setHovered(false);
  if (activePointerId !== null) {
    activePointerId = null;
    pointerDragStart = null;
    delete handleElement.dataset.dragging;
    window.petWindow.cancelDrag();
  }
});
})();
