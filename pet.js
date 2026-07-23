const spriteElement = document.getElementById('petSprite');
const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('statusText');

const ANIMATIONS = Object.freeze({
  idle: { row: 0, frames: 6, frameMs: 240 },
  'running-right': { row: 1, frames: 8, frameMs: 105 },
  'running-left': { row: 2, frames: 8, frameMs: 105 },
  waving: { row: 3, frames: 4, frameMs: 190 },
  jumping: { row: 4, frames: 5, frameMs: 145 },
  failed: { row: 5, frames: 8, frameMs: 210 },
  waiting: { row: 6, frames: 6, frameMs: 240 },
  running: { row: 7, frames: 6, frameMs: 135 },
  review: { row: 8, frames: 6, frameMs: 210 },
});

let animationTimer = null;
let currentAnimation = null;
let currentTone = null;
let movementActive = false;
let greeted = false;

/** 将指定动画帧定位到精灵图中的对应单元格。 */
function renderFrame(animation, frameIndex) {
  const x = (frameIndex * 100) / 7;
  const y = (animation.row * 100) / 8;
  spriteElement.style.backgroundPosition = `${x}% ${y}%`;
}

/** 播放循环动画或只播放一次的状态动画。 */
function playAnimation(name, options = {}) {
  const animation = ANIMATIONS[name];
  if (!animation) return;
  if (!options.once && currentAnimation === name && animationTimer) return;

  if (animationTimer) clearInterval(animationTimer);
  currentAnimation = name;
  let frameIndex = 0;
  renderFrame(animation, frameIndex);

  animationTimer = setInterval(() => {
    frameIndex += 1;
    if (frameIndex >= animation.frames) {
      if (options.once) {
        clearInterval(animationTimer);
        animationTimer = null;
        options.onComplete?.();
        return;
      }
      frameIndex = 0;
    }
    renderFrame(animation, frameIndex);
  }, animation.frameMs);
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
  if (animationTimer) clearInterval(animationTimer);
  unsubscribeStatus();
  unsubscribeMotion();
});
