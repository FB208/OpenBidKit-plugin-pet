const previewElement = document.getElementById('dragPreviewSprite');
const bubbleWindowElement = document.getElementById('dragPreviewBubbleWindow');

const FRAME_DURATION_MS = 60;
const FRAME_COUNT = 16;
const START_ROWS = Object.freeze({
  right: 3,
  left: 5,
});

let animationRequest = null;
let animationStartedAt = null;
let direction = 'right';

/** 绘制拖动方向对应的奔跑动画帧。 */
function renderFrame(frameIndex) {
  const column = frameIndex % 8;
  const row = START_ROWS[direction] + Math.floor(frameIndex / 8);
  previewElement.style.backgroundPosition = `${(column * 100) / 7}% ${(row * 100) / 18}%`;
}

/** 在固定画布中持续播放拖动动画。 */
function animate(timestamp) {
  if (animationStartedAt === null) animationStartedAt = timestamp;
  const frameIndex = Math.floor((timestamp - animationStartedAt) / FRAME_DURATION_MS) % FRAME_COUNT;
  renderFrame(frameIndex);
  animationRequest = requestAnimationFrame(animate);
}

/** 应用主进程计算出的角色与气泡画布内位置。 */
function renderPreview(preview) {
  if (!preview?.active) {
    previewElement.style.display = 'none';
    bubbleWindowElement.style.display = 'none';
    return;
  }

  direction = preview.direction === 'left' ? 'left' : 'right';
  previewElement.style.transform = `translate3d(${Math.round(preview.x)}px, ${Math.round(preview.y)}px, 0)`;
  bubbleWindowElement.style.transform = `translate3d(${Math.round(preview.bubbleX)}px, ${Math.round(preview.bubbleY)}px, 0)`;
  previewElement.style.display = 'block';
  bubbleWindowElement.style.display = 'flex';
  if (animationRequest === null) {
    animationStartedAt = null;
    animationRequest = requestAnimationFrame(animate);
  }
}

const unsubscribePreview = window.petDragPreview.onChange(renderPreview);

window.addEventListener('beforeunload', () => {
  if (animationRequest !== null) cancelAnimationFrame(animationRequest);
  unsubscribePreview();
});