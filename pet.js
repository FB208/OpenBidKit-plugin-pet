const spriteElement = document.getElementById('petSprite');
const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('statusText');

const ANIMATIONS = Object.freeze({
  blink: { startRow: 0, frameIndices: [23, 19, 20, 21, 22, 23], keyframeMs: 85 },
  'idle-hover': { startRow: 0, frames: 24, keyframeMs: 160 },
  'running-right': { startRow: 3, frames: 16, keyframeMs: 60 },
  'running-left': { startRow: 5, frames: 16, keyframeMs: 60 },
  waving: { startRow: 7, frames: 16, keyframeMs: 70 },
  jumping: { startRow: 9, frames: 16, keyframeMs: 65 },
  failed: { startRow: 11, frames: 16, keyframeMs: 90 },
  waiting: { startRow: 13, frames: 16, keyframeMs: 80 },
  running: { startRow: 15, frames: 16, keyframeMs: 60 },
  review: { startRow: 17, frames: 16, keyframeMs: 80 },
});

const BLINK_INTERVAL_MS = 5_000;

let animationFrameRequest = null;
let blinkTimeout = null;
let animationRunId = 0;
let currentAnimation = null;
let currentTone = null;
let movementActive = false;
let greeted = false;
let startupAnimationActive = false;
let pointerOverPet = false;
let activePointerId = null;

/** 将指定动画帧定位到精灵图中的对应单元格。 */
function renderFrame(animation, frameIndex) {
  const column = frameIndex % 8;
  const row = animation.startRow + Math.floor(frameIndex / 8);
  const x = (column * 100) / 7;
  const y = (row * 100) / 18;
  spriteElement.style.backgroundPosition = `${x}% ${y}%`;
}

/** 停止当前动画帧调度。 */
function stopAnimation() {
  animationRunId += 1;
  if (animationFrameRequest !== null) {
    cancelAnimationFrame(animationFrameRequest);
    animationFrameRequest = null;
  }
  if (blinkTimeout !== null) {
    clearTimeout(blinkTimeout);
    blinkTimeout = null;
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
  const frameIndices = animation.frameIndices
    ?? Array.from({ length: animation.frames }, (_value, index) => index);
  const totalDuration = frameIndices.length * animation.keyframeMs;
  let startedAt = null;
  let renderedFrame = -1;

  /** 根据屏幕刷新时间选择当前真实帧。 */
  function animate(timestamp) {
    if (runId !== animationRunId) return;
    if (startedAt === null) startedAt = timestamp;

    const elapsed = timestamp - startedAt;
    if (once && elapsed >= totalDuration) {
      renderFrame(animation, frameIndices[frameIndices.length - 1]);
      animationFrameRequest = null;
      options.onComplete?.();
      return;
    }

    const cycleElapsed = once ? elapsed : elapsed % totalDuration;
    const timelineIndex = Math.min(
      frameIndices.length - 1,
      Math.floor(cycleElapsed / animation.keyframeMs),
    );
    if (timelineIndex !== renderedFrame) {
      renderedFrame = timelineIndex;
      renderFrame(animation, frameIndices[timelineIndex]);
    }
    animationFrameRequest = requestAnimationFrame(animate);
  }

  animationFrameRequest = requestAnimationFrame(animate);
}

/** 判断当前是否允许播放待命微动画。 */
function canPlayIdleAmbientAnimation() {
  return currentTone === 'idle' && !movementActive && !startupAnimationActive;
}

/** 回到待命静止帧，并在鼠标未悬浮时安排下一次眨眼。 */
function startIdleRest() {
  const animation = ANIMATIONS['idle-hover'];
  stopAnimation();
  currentAnimation = 'idle-rest';
  renderFrame(animation, 0);

  if (!canPlayIdleAmbientAnimation() || pointerOverPet) return;

  const runId = animationRunId;
  blinkTimeout = setTimeout(() => {
    blinkTimeout = null;
    if (runId !== animationRunId || !canPlayIdleAmbientAnimation() || pointerOverPet) {
      return;
    }

    playAnimation('blink', {
      once: true,
      onComplete: () => {
        if (canPlayIdleAmbientAnimation()) startIdleRest();
      },
    });
  }, BLINK_INTERVAL_MS);
}

/** 鼠标进入角色时播放一次原待机互动，停留期间不循环。 */
function playIdleHoverAnimation() {
  if (!pointerOverPet || !canPlayIdleAmbientAnimation()) return;
  if (currentAnimation === 'idle-hover' && animationFrameRequest !== null) return;

  playAnimation('idle-hover', {
    once: true,
    onComplete: () => {
      if (canPlayIdleAmbientAnimation()) startIdleRest();
    },
  });
}

/** 记录鼠标进入角色，并按空闲状态触发互动。 */
function handlePointerEnter() {
  pointerOverPet = true;
  playIdleHoverAnimation();
}

/** 鼠标离开角色后恢复五秒眨眼计时。 */
function handlePointerLeave() {
  pointerOverPet = false;
  if (!canPlayIdleAmbientAnimation()) return;
  if (currentAnimation !== 'idle-hover') startIdleRest();
}

/** 根据任务状态选择对应的角色动画。 */
function playStatusAnimation() {
  if (movementActive) return;

  if (currentTone !== 'idle') startupAnimationActive = false;

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
    startupAnimationActive = true;
    playAnimation('waving', {
      once: true,
      onComplete: () => {
        startupAnimationActive = false;
        if (!canPlayIdleAmbientAnimation()) return;
        if (pointerOverPet) {
          playIdleHoverAnimation();
        } else {
          startIdleRest();
        }
      },
    });
    return;
  }
  if (pointerOverPet) {
    playIdleHoverAnimation();
  } else {
    startIdleRest();
  }
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
    startupAnimationActive = false;
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

/** 在角色本体按下主指针时开始手动窗口拖拽。 */
function handlePointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || activePointerId !== null) return;

  event.preventDefault();
  activePointerId = event.pointerId;
  spriteElement.dataset.dragging = 'true';
  spriteElement.setPointerCapture?.(event.pointerId);
  window.petWindow.startDrag({
    pointerScreenX: event.screenX,
    pointerScreenY: event.screenY,
    pointerWindowX: event.clientX,
    pointerWindowY: event.clientY,
  });
}

/** 将被捕获指针的屏幕坐标持续发送给主进程。 */
function handlePointerMove(event) {
  if (activePointerId !== event.pointerId) return;

  window.petWindow.moveDrag({
    pointerScreenX: event.screenX,
    pointerScreenY: event.screenY,
  });
}

/** 释放指针捕获并结束窗口拖拽。 */
function finishPointerDrag(event) {
  if (activePointerId !== event.pointerId) return;

  const pointerId = activePointerId;
  activePointerId = null;
  delete spriteElement.dataset.dragging;
  window.petWindow.endDrag();

  if (
    event.type !== 'lostpointercapture'
    && spriteElement.hasPointerCapture?.(pointerId)
  ) {
    spriteElement.releasePointerCapture(pointerId);
  }
}

spriteElement.addEventListener('pointerenter', handlePointerEnter);
spriteElement.addEventListener('pointerleave', handlePointerLeave);
spriteElement.addEventListener('pointerdown', handlePointerDown);
spriteElement.addEventListener('pointermove', handlePointerMove);
spriteElement.addEventListener('pointerup', finishPointerDrag);
spriteElement.addEventListener('pointercancel', finishPointerDrag);
spriteElement.addEventListener('lostpointercapture', finishPointerDrag);

const unsubscribeStatus = window.petStatus.onChange(renderStatus);
const unsubscribeMotion = window.petStatus.onMotion(renderMotion);

window.addEventListener('beforeunload', () => {
  if (activePointerId !== null) {
    activePointerId = null;
    delete spriteElement.dataset.dragging;
    window.petWindow.endDrag();
  }
  stopAnimation();
  unsubscribeStatus();
  unsubscribeMotion();
});
