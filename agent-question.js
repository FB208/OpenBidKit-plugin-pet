(() => {
const cardElement = document.getElementById('questionCard');
const copyElement = document.getElementById('questionCopy');
const optionListElement = document.getElementById('optionList');
const customPanelElement = document.getElementById('customPanel');
const customLabelElement = document.getElementById('customLabel');
const customAnswerElement = document.getElementById('customAnswer');
const submitCustomElement = document.getElementById('submitCustom');
const countdownElement = document.getElementById('countdown');
const errorElement = document.getElementById('errorMessage');

let currentQuestion = null;
let selectedCustomOption = null;
let submitting = false;
let countdownTimer = null;

/** 将行内加粗/斜体标记渲染为安全 DOM 节点，不解析 HTML。 */
function appendInlineText(parent, text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  parts.forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else if (part.startsWith('*') && part.endsWith('*')) {
      const emphasis = document.createElement('em');
      emphasis.textContent = part.slice(1, -1);
      parent.appendChild(emphasis);
    } else if (part) {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

/** 将问题文本按段落和列表渲染为安全文本节点。 */
function renderQuestionCopy(markdown) {
  copyElement.replaceChildren();
  const lines = String(markdown || '').split(/\r?\n/);
  let list = null;
  let listType = '';

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      listType = '';
      return;
    }
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    const listMatch = unorderedMatch || orderedMatch;
    if (listMatch) {
      const nextListType = orderedMatch ? 'ol' : 'ul';
      if (!list || listType !== nextListType) {
        list = document.createElement(nextListType);
        listType = nextListType;
        copyElement.appendChild(list);
      }
      const item = document.createElement('li');
      appendInlineText(item, listMatch[1]);
      list.appendChild(item);
      return;
    }
    list = null;
    listType = '';
    const paragraph = document.createElement('p');
    appendInlineText(paragraph, line.replace(/^#{1,6}\s+/, ''));
    copyElement.appendChild(paragraph);
  });
}

/** 上报卡片实际高度；窗口显示与否不影响该上报路径。 */
function reportHeight() {
  window.petAgentQuestion.reportHeight(cardElement.scrollHeight + 16);
}

/** 内容尺寸变化时自动跟随上报（展开输入区、显示错误等）。 */
const cardResizeObserver = new ResizeObserver(() => {
  if (currentQuestion) reportHeight();
});
cardResizeObserver.observe(cardElement);

/** 显示提交错误。 */
function showError(error) {
  errorElement.textContent = error instanceof Error
    ? error.message
    : String(error || '提交回答失败，请重试');
  errorElement.hidden = false;
}

/** 同步选项与提交按钮的忙碌状态。 */
function renderSubmitting() {
  optionListElement.querySelectorAll('button').forEach((button) => {
    button.disabled = submitting;
  });
  customAnswerElement.disabled = submitting;
  submitCustomElement.disabled = submitting || !customAnswerElement.value.trim();
  submitCustomElement.textContent = submitting ? '正在提交...' : '确定并继续';
}

/** 渲染自动回答倒计时；没有截止时间时隐藏。 */
function renderCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  const deadline = currentQuestion?.auto_answer_at
    ? new Date(currentQuestion.auto_answer_at).getTime()
    : 0;
  const recommended = currentQuestion?.options?.find(
    (option) => option.recommended && !option.custom,
  );
  if (!Number.isFinite(deadline) || deadline <= 0 || !recommended) {
    countdownElement.hidden = true;
    return;
  }

  const update = () => {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    countdownElement.textContent = `${seconds} 秒后自动选择“${recommended.label}”`;
    countdownElement.hidden = false;
  };
  update();
  countdownTimer = setInterval(update, 250);
}

/** 停止当前问题的自动回答倒计时。 */
async function suppressAutoAnswer() {
  if (!currentQuestion) return;
  try {
    await window.petAgentQuestion.suppressAutoAnswer({
      question_id: currentQuestion.question_id,
    });
  } catch {
    // 倒计时抑制失败不阻塞回答流程。
  }
}

/** 提交普通选项。 */
async function answerOption(option) {
  if (!currentQuestion || submitting) return;
  const questionId = currentQuestion.question_id;
  submitting = true;
  errorElement.hidden = true;
  renderSubmitting();
  try {
    await suppressAutoAnswer();
    await window.petAgentQuestion.answer({
      question_id: questionId,
      option_id: option.id,
    });
  } catch (error) {
    if (currentQuestion?.question_id === questionId) {
      submitting = false;
      renderSubmitting();
      showError(error);
    }
  }
}

/** 选择需要补充文本的选项并展开输入区。 */
async function selectCustomOption(option, button) {
  if (!currentQuestion || submitting) return;
  selectedCustomOption = option;
  optionListElement.querySelectorAll('.question-option').forEach((element) => {
    element.classList.toggle('is-selected', element === button);
    element.setAttribute('aria-checked', String(element === button));
  });
  customLabelElement.textContent = `${option.label} · 具体要求`;
  customPanelElement.hidden = false;
  errorElement.hidden = true;
  await suppressAutoAnswer();
  renderCountdown();
  renderSubmitting();
  customAnswerElement.focus();
}

/** 创建一个选项按钮。 */
function createOptionButton(option, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'question-option';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', 'false');

  const indexElement = document.createElement('span');
  indexElement.className = 'question-option__index';
  indexElement.textContent = String(index + 1);
  const copy = document.createElement('span');
  copy.className = 'question-option__copy';
  const label = document.createElement('strong');
  label.textContent = option.label;
  copy.appendChild(label);
  if (option.description) {
    const description = document.createElement('small');
    description.textContent = option.description;
    copy.appendChild(description);
  }
  const suffix = document.createElement('span');
  suffix.className = option.recommended ? 'question-option__badge' : 'question-option__arrow';
  suffix.textContent = option.recommended ? '推荐' : '›';
  button.append(indexElement, copy, suffix);
  button.addEventListener('click', () => {
    if (option.custom) {
      void selectCustomOption(option, button);
    } else {
      void answerOption(option);
    }
  });
  return button;
}

/** 渲染主进程推送的当前 Agent 问题。 */
function renderQuestion(question) {
  const changed = question?.question_id !== currentQuestion?.question_id;
  currentQuestion = question || null;
  if (!currentQuestion) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    return;
  }

  if (!changed) {
    // 同一问题仅刷新倒计时（auto_answer_at 可能被主程序更新或清除）。
    renderCountdown();
    return;
  }

  selectedCustomOption = null;
  submitting = false;
  customAnswerElement.value = '';
  customPanelElement.hidden = true;
  errorElement.hidden = true;
  renderQuestionCopy(currentQuestion.question);
  optionListElement.replaceChildren(
    ...(currentQuestion.options || []).map(createOptionButton),
  );
  renderCountdown();
  renderSubmitting();
  reportHeight();
}

/** 提交自定义回答。 */
async function submitCustomAnswer() {
  const answer = customAnswerElement.value.trim();
  if (!currentQuestion || !selectedCustomOption || !answer || submitting) return;
  const questionId = currentQuestion.question_id;
  submitting = true;
  errorElement.hidden = true;
  renderSubmitting();
  try {
    await window.petAgentQuestion.answer({
      question_id: questionId,
      option_id: selectedCustomOption.id,
      custom_answer: answer,
    });
  } catch (error) {
    if (currentQuestion?.question_id === questionId) {
      submitting = false;
      renderSubmitting();
      showError(error);
    }
  }
}

customAnswerElement.addEventListener('input', renderSubmitting);
customAnswerElement.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void submitCustomAnswer();
  }
});
submitCustomElement.addEventListener('click', () => void submitCustomAnswer());

const unsubscribeQuestion = window.petAgentQuestion.onChange(renderQuestion);

window.addEventListener('beforeunload', () => {
  if (countdownTimer) clearInterval(countdownTimer);
  cardResizeObserver.disconnect();
  unsubscribeQuestion();
});
})();
