(() => {
const previewElement = document.getElementById('petSprite');
const bubbleWindowElement = document.getElementById('dragPreviewBubbleWindow');

/** 在唯一视觉层内同步角色与气泡位置。 */
function renderPreview(preview) {
  if (!preview?.active) {
    previewElement.style.display = 'none';
    bubbleWindowElement.style.display = 'none';
    return;
  }

  previewElement.style.transform = `translate3d(${Math.round(preview.x)}px, ${Math.round(preview.y)}px, 0)`;
  bubbleWindowElement.style.transform = `translate3d(${Math.round(preview.bubbleX)}px, ${Math.round(preview.bubbleY)}px, 0)`;
  previewElement.style.display = 'block';
  bubbleWindowElement.style.display = 'flex';
}

const unsubscribePreview = window.petDragPreview.onChange(renderPreview);

window.addEventListener('beforeunload', () => {
  unsubscribePreview();
});
})();
