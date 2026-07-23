const spriteElement = document.getElementById('petSprite');
const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('statusText');

const ANIMATIONS = Object.freeze({
  idle: { startRow: 0, frames: 16, keyframeMs: 100 },
  'running-right': { startRow: 2, frames: 16, keyframeMs: 60 },
  'running-left': { startRow: 4, frames: 16, keyframeMs: 60 },
  waving: { startRow: 6, frames: 16, keyframeMs: 70 },
  jumping: { startRow: 8, frames: 16, keyframeMs: 65 },
  failed: { startRow: 10, frames: 16, keyframeMs: 90 },
  waiting: { startRow: 12, frames: 16, keyframeMs: 80 },
  running: { startRow: 14, frames: 16, keyframeMs: 60 },
  review: { startRow: 16, frames: 16, keyframeMs: 80 },
});

let animationFrameRequest = null;
let animationRunId = 0;
let currentAnimation = null;
let currentTone = null;
let movementActive = false;
let greeted = false;

/** 将指定动画帧定位到精灵图中的对应单元格。 */
function renderFrame(animation, frameIndex) {
  const column = frameIndex % 8;
  const row = animation.startRow + Math.floor(frameIndex / 8);
  const x = (column * 100) / 7;
  const y = (row * 100) / 17;
  spriteElement.style.backgroundPosition = `${x}% ${y}%`;
}

/** 停止当前动画帧调度。 */
function stopAnimation() {
  animationRunId += 1;
  if (animationFrameRequest !== null) {
    cancelAnimationFrame(animationFrameRequest);
    animationFrameRequest = null;
  }
}

/** 按时间轴播放真实帧，不混合相邻姿态。 */
function playAnimation(name, options = {}) {
  const animation = ANIMATIONS[name];
  if (!animation) return;
  if (!options.once && currentAnimation === name && animationFrameRequest !== null) return;

  stopAnimation();
  currentAnimation = name;
  const runId = animationRunId;
  const once = Boolean(options.once);
  const totalDuration = animation.frames * animation.keyframeMs;
  let startedAt = null;
  let renderedFrame = -1;

  /** 根据屏幕刷新时间选择当前真实帧。 */
  function animate(timestamp) {
    if (runId !== animationRunId) return;
    if (startedAt === null) startedAt = timestamp;

    const elapsed = timestamp - startedAt;
    if (once && elapsed >= totalDuration) {
      renderFrame(animation, animation.frames - 1);
      animationFrameRequest = null;
      options.onComplete?.();
      return;
    }

    const cycleElapsed = once ? elapsed : elapsed % totalDuration;
    const frameIndex = Math.min(
      animation.frames - 1,
      Math.floor(cycleElapsed / animation.keyframeMs),
    );
    if (frameIndex !== renderedFrame) {
      renderedFrame = frameIndex;
      renderFrame(animation, frameIndex);
    }
    animationFrameRequest = requestAnimationFrame(animate);
  }

  animationFrameRequest = requestAnimationFrame(animate);
}

/** 根据任务状态选择对应的角色动画。 */
function playStatusAnimation() {
  if (movementActive) return;

  if (currentTone === 'success') {
    playAnimation('jumping', {
      once: true,
      onComplete: () => {
        if (!movementActive && currentTone === 'success') playAnimation('review');
      },
    });
    return;
  }
  if (currentTone === 'error') {
    playAnimation('failed');
    return;
  }
  if (currentTone === 'paused') {
    playAnimation('waiting');
    return;
  }
  if (currentTone === 'running') {
    playAnimation('running');
    return;
  }
  if (!greeted) {
    greeted = true;
    playAnimation('waving', {
      once: true,
      onComplete: () => {
        if (!movementActive && currentTone === 'idle') playAnimation('idle');
      },
    });
    return;
  }
  playAnimation('idle');
}

/** 将主进程发送的状态应用到悬浮窗口。 */
function renderStatus(status) {
  const text = String(status?.text || '当前无执行任务');
  const tone = String(status?.tone || 'idle');
  statusTextElement.textContent = text;
  statusElement.dataset.tone = tone;
  statusElement.title = text;

  if (tone !== currentTone) {
    currentTone = tone;
    playStatusAnimation();
  }
}

/** 拖动悬浮窗时临时播放对应方向的移动动画。 */
function renderMotion(motion) {
  if (motion?.active) {
    movementActive = true;
    playAnimation(motion.direction === 'left' ? 'running-left' : 'running-right');
    return;
  }

  if (movementActive) {
    movementActive = false;
    currentAnimation = null;
    playStatusAnimation();
  }
}

const unsubscribeStatus = window.petStatus.onChange(renderStatus);
const unsubscribeMotion = window.petStatus.onMotion(renderMotion);

window.addEventListener('beforeunload', () => {
  stopAnimation();
  unsubscribeStatus();
  unsubscribeMotion();
});
