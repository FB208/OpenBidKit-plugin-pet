(() => {
const cardElement = document.getElementById('selectionCard');
const filtersElement = document.getElementById('attrFilters');
const listElement = document.getElementById('itemList');
const countElement = document.getElementById('selectedCount');
const countdownElement = document.getElementById('countdown');
const errorElement = document.getElementById('errorMessage');
const dismissButton = document.getElementById('dismissButton');
const confirmButton = document.getElementById('confirmButton');

const ATTR_ORDER = ['通用', '商务', '资信', '技术', '其他'];
const CONTENT_MODE_LABELS = {
  'ai-generate': 'AI生成',
  'template-fill': '模板填写',
  'point-to-point': '点对点应答表',
  other: '其他模式',
};

let currentSelection = null;
let selectedIds = new Set();
let submitting = false;
let suppressedTaskId = null;
let countdownTimer = null;

/** 归一化条目属性；主程序中 attr 可缺省。 */
function getItemAttr(item) {
  return item.attr || '其他';
}

/** 上报卡片实际高度；窗口显示与否不影响该上报路径。 */
function reportHeight() {
  window.petOutlineSelection.reportHeight(cardElement.scrollHeight + 16);
}

/** 内容尺寸变化时自动跟随上报（错误提示展开、列表变化等）。 */
const cardResizeObserver = new ResizeObserver(() => {
  if (currentSelection) reportHeight();
});
cardResizeObserver.observe(cardElement);

/** 显示提交错误。 */
function showError(error) {
  errorElement.textContent = error instanceof Error
    ? error.message
    : String(error || '确认一级目录失败，请重试');
  errorElement.hidden = false;
}

/** 用户任何交互后停止本任务的自动确认倒计时（每个任务只需一次）。 */
async function suppressAutoConfirm() {
  if (!currentSelection || suppressedTaskId === currentSelection.task_id) return;
  suppressedTaskId = currentSelection.task_id;
  countdownElement.hidden = true;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  try {
    await window.petOutlineSelection.suppressAutoConfirm({
      taskId: currentSelection.task_id,
    });
  } catch {
    // 倒计时抑制失败不阻塞勾选与确认流程。
  }
}

/** 渲染自动确认倒计时；没有截止时间或已抑制时隐藏。 */
function renderCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  const deadline = currentSelection?.auto_answer_at
    ? new Date(currentSelection.auto_answer_at).getTime()
    : 0;
  if (
    !Number.isFinite(deadline)
    || deadline <= 0
    || suppressedTaskId === currentSelection?.task_id
  ) {
    countdownElement.hidden = true;
    return;
  }

  const update = () => {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    countdownElement.textContent = `${seconds} 秒后自动确认当前选择`;
    countdownElement.hidden = false;
  };
  update();
  countdownTimer = setInterval(update, 250);
}

/** 同步已选计数、属性筛选高亮和按钮可用状态。 */
function renderSummary() {
  const items = currentSelection?.items || [];
  countElement.textContent = `已选 ${selectedIds.size} / ${items.length}`;
  confirmButton.disabled = submitting || selectedIds.size === 0;
  confirmButton.textContent = submitting ? '正在确认...' : '确认选择';
  dismissButton.disabled = submitting;

  listElement.querySelectorAll('.selection-item').forEach((row) => {
    const checked = selectedIds.has(row.dataset.itemId);
    row.classList.toggle('is-checked', checked);
    const checkbox = row.querySelector('input');
    if (checkbox) {
      checkbox.checked = checked;
      checkbox.disabled = submitting;
    }
  });

  filtersElement.querySelectorAll('.selection-filter').forEach((chip) => {
    const attrItems = items.filter((item) => getItemAttr(item) === chip.dataset.attr);
    const allSelected = attrItems.length > 0
      && attrItems.every((item) => selectedIds.has(item.id));
    chip.classList.toggle('is-active', allSelected);
    chip.disabled = submitting;
  });
}

/** 点击属性筛选：该属性下条目全选/全不选。 */
function toggleAttr(attr) {
  if (!currentSelection || submitting) return;
  const attrItems = (currentSelection.items || [])
    .filter((item) => getItemAttr(item) === attr);
  if (!attrItems.length) return;
  const allSelected = attrItems.every((item) => selectedIds.has(item.id));
  attrItems.forEach((item) => {
    if (allSelected) selectedIds.delete(item.id);
    else selectedIds.add(item.id);
  });
  void suppressAutoConfirm();
  renderSummary();
}

/** 创建一个条目勾选行。 */
function createItemRow(item) {
  const row = document.createElement('label');
  row.className = 'selection-item';
  row.dataset.itemId = item.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedIds.has(item.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedIds.add(item.id);
    else selectedIds.delete(item.id);
    void suppressAutoConfirm();
    renderSummary();
  });

  const title = document.createElement('span');
  title.className = 'selection-item__title';
  title.textContent = item.title || '(未命名目录)';
  title.title = item.title || '';

  const attrBadge = document.createElement('span');
  attrBadge.className = 'selection-item__badge selection-item__badge--attr';
  attrBadge.textContent = getItemAttr(item);

  row.append(checkbox, title, attrBadge);

  const modeLabel = CONTENT_MODE_LABELS[item.content_mode];
  if (modeLabel) {
    const modeBadge = document.createElement('span');
    modeBadge.className = 'selection-item__badge selection-item__badge--mode';
    modeBadge.textContent = modeLabel;
    row.appendChild(modeBadge);
  }
  return row;
}

/** 渲染主进程推送的一级目录选择状态。 */
function renderSelection(selection) {
  const changed = selection?.task_id !== currentSelection?.task_id;
  currentSelection = selection || null;
  if (!currentSelection) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    return;
  }

  if (!changed) {
    // 同一任务仅刷新倒计时（auto_answer_at 可能被主程序更新或清除），保留用户勾选草稿。
    renderCountdown();
    renderSummary();
    return;
  }

  submitting = false;
  suppressedTaskId = null;
  selectedIds = new Set(currentSelection.selected_ids || []);
  errorElement.hidden = true;

  const items = currentSelection.items || [];
  const presentAttrs = ATTR_ORDER.filter(
    (attr) => items.some((item) => getItemAttr(item) === attr),
  );
  filtersElement.replaceChildren(...presentAttrs.map((attr) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'selection-filter';
    chip.dataset.attr = attr;
    chip.textContent = attr;
    chip.addEventListener('click', () => toggleAttr(attr));
    return chip;
  }));
  listElement.replaceChildren(...items.map(createItemRow));

  renderCountdown();
  renderSummary();
  reportHeight();
}

/** 提交确认：payload 与主界面 Renderer 完全一致。 */
async function confirmSelection() {
  if (!currentSelection || submitting || selectedIds.size === 0) return;
  const taskId = currentSelection.task_id;
  submitting = true;
  errorElement.hidden = true;
  renderSummary();
  try {
    await suppressAutoConfirm();
    await window.petOutlineSelection.confirm({
      taskId,
      items: currentSelection.items,
      selectedIds: currentSelection.items
        .map((item) => item.id)
        .filter((id) => selectedIds.has(id)),
    });
  } catch (error) {
    if (currentSelection?.task_id === taskId) {
      submitting = false;
      renderSummary();
      showError(error);
    }
  }
}

/** 稍后处理：停止倒计时并交还给主界面。 */
function dismissSelection() {
  if (!currentSelection || submitting) return;
  window.petOutlineSelection.dismiss({ taskId: currentSelection.task_id });
}

confirmButton.addEventListener('click', () => void confirmSelection());
dismissButton.addEventListener('click', dismissSelection);

const unsubscribeSelection = window.petOutlineSelection.onChange(renderSelection);

window.addEventListener('beforeunload', () => {
  if (countdownTimer) clearInterval(countdownTimer);
  cardResizeObserver.disconnect();
  unsubscribeSelection();
});
})();
