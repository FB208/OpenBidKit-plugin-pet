const primaryFrameElement = document.getElementById('petFramePrimary');
const secondaryFrameElement = document.getElementById('petFrameSecondary');
const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('statusText');

const ANIMATIONS = Object.freeze({
  idle: { row: 0, frames: 6, keyframeMs: 240 },
  'running-right': { row: 1, frames: 8, keyframeMs: 105 },
  'running-left': { row: 2, frames: 8, keyframeMs: 105 },
  waving: { row: 3, frames: 4, keyframeMs: 190 },
  jumping: { row: 4, frames: 5, keyframeMs: 145 },
  failed: { row: 5, frames: 8, keyframeMs: 210 },
  waiting: { row: 6, frames: 6, keyframeMs: 240 },
  running: { row: 7, frames: 6, keyframeMs: 135 },
  review: { row: 8, frames: 6, keyframeMs: 210 },
});

const BLEND_START = 0.12;
const BLEND_END = 0.88;

let animationFrameRequest = null;
let animationRunId = 0;
let currentAnimation = null;
let currentTone = null;
let movementActive = false;
let greeted = false;

/** 将指定图层定位到精灵图中的对应单元格。 */
function positionFrame(element, animation, frameIndex) {
  const x = (frameIndex * 100) / 7;
  const y = (animation.row * 100) / 8;
  element.style.backgroundPosition = `${x}% ${y}%`;
}

/** 使用平滑曲线计算相邻关键帧的融合进度。 */
function calculateBlend(progress) {
  const normalized = Math.max(
    0,
    Math.min(1, (progress - BLEND_START) / (BLEND_END - BLEND_START)),
  );
  return normalized * normalized * (3 - (2 * normalized));
}

/** 通过双图层融合渲染关键帧之间的亚帧画面。 */
function renderInterpolatedFrame(animation, frameIndex, nextFrameIndex, blend) {
  positionFrame(primaryFrameElement, animation, frameIndex);
  positionFrame(secondaryFrameElement, animation, nextFrameIndex);
  primaryFrameElement.style.opacity = String(1 - blend);
  secondaryFrameElement.style.opacity = String(blend);
}

/** 停止当前动画帧调度。 */
function stopAnimation() {
  animationRunId += 1;
  if (animationFrameRequest !== null) {
    cancelAnimationFrame(animationFrameRequest);
    animationFrameRequest = null;
  }
}

/** 播放循环动画或只播放一次的状态动画。 */
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

  renderInterpolatedFrame(animation, 0, animation.frames > 1 ? 1 : 0, 0);

  /** 按屏幕刷新率推进亚帧融合，保持原动作总时长不变。 */
  function animate(timestamp) {
    if (runId !== animationRunId) return;
    if (startedAt === null) startedAt = timestamp;

    const elapsed = timestamp - startedAt;
    if (once && elapsed >= totalDuration) {
      renderInterpolatedFrame(animation, animation.frames - 1, animation.frames - 1, 0);
      animationFrameRequest = null;
      options.onComplete?.();
      return;
    }

    const cycleElapsed = once ? elapsed : elapsed % totalDuration;
    const frameIndex = Math.min(
      animation.frames - 1,
      Math.floor(cycleElapsed / animation.keyframeMs),
    );
    const nextFrameIndex = once
      ? Math.min(frameIndex + 1, animation.frames - 1)
      : (frameIndex + 1) % animation.frames;
    const frameProgress = (cycleElapsed % animation.keyframeMs) / animation.keyframeMs;
    const blend = nextFrameIndex === frameIndex ? 0 : calculateBlend(frameProgress);

    renderInterpolatedFrame(animation, frameIndex, nextFrameIndex, blend);
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
