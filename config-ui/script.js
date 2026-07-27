(() => {
  const skinRegistry = window.openBidKitPetSkins;
  const effectRegistry = window.openBidKitPetEffects;
  const skinList = document.getElementById('skinList');
  const effectList = document.getElementById('effectList');
  const saveStatus = document.getElementById('saveStatus');
  const skinCardTemplate = document.getElementById('skinCardTemplate');
  const effectOptionTemplate = document.getElementById('effectOptionTemplate');

  let selectedSkinId = null;
  let enabledEffectIds = new Set();
  let saveInProgress = false;

  /** 将插件根目录下的资源路径转换为配置窗口可用的 URL。 */
  function getAssetUrl(relativePath) {
    return new URL(`../${relativePath}`, window.location.href).href;
  }

  /** 更新设置页底部的保存状态。 */
  function showStatus(message, tone = 'muted') {
    saveStatus.textContent = message;
    saveStatus.dataset.tone = tone;
  }

  /** 根据当前选择和保存状态刷新全部设置控件。 */
  function refreshControls() {
    for (const card of skinList.querySelectorAll('.skin-card')) {
      const selected = card.dataset.skinId === selectedSkinId;
      card.setAttribute('aria-checked', String(selected));
      card.disabled = saveInProgress;
    }

    for (const toggle of effectList.querySelectorAll('.effect-option__toggle')) {
      toggle.checked = enabledEffectIds.has(toggle.dataset.effectId);
      toggle.disabled = saveInProgress;
    }
  }

  /** 保存皮肤选择，并由主程序即时通知运行中的桌宠。 */
  async function selectSkin(skinId) {
    if (saveInProgress || skinId === selectedSkinId) return;

    saveInProgress = true;
    refreshControls();
    showStatus('正在应用皮肤…');

    try {
      const saved = await window.pluginConfig.set('skinId', skinId);
      if (!saved) {
        throw new Error('皮肤设置保存失败');
      }
      selectedSkinId = skinId;
      showStatus('皮肤已保存并应用。', 'success');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : '皮肤设置保存失败。', 'error');
    } finally {
      saveInProgress = false;
      refreshControls();
    }
  }

  /** 按注册顺序生成要持久化的已启用效果列表。 */
  function getEnabledEffectIds() {
    return effectRegistry.effects
      .filter((effect) => enabledEffectIds.has(effect.id))
      .map((effect) => effect.id);
  }

  /** 保存单个效果开关，并由主程序即时应用。 */
  async function setEffectEnabled(effectId, enabled) {
    if (saveInProgress) return;

    const previousEffectIds = enabledEffectIds;
    enabledEffectIds = new Set(enabledEffectIds);
    if (enabled) {
      enabledEffectIds.add(effectId);
    } else {
      enabledEffectIds.delete(effectId);
    }

    saveInProgress = true;
    refreshControls();
    showStatus('正在应用效果…');

    try {
      const saved = await window.pluginConfig.set('enabledEffectIds', getEnabledEffectIds());
      if (!saved) {
        throw new Error('效果设置保存失败');
      }
      showStatus('效果已保存并应用。', 'success');
    } catch (error) {
      enabledEffectIds = previousEffectIds;
      showStatus(error instanceof Error ? error.message : '效果设置保存失败。', 'error');
    } finally {
      saveInProgress = false;
      refreshControls();
    }
  }

  /** 从共享注册表生成皮肤选项。 */
  function renderSkinOptions() {
    const fragment = document.createDocumentFragment();

    for (const skin of skinRegistry.skins) {
      const card = skinCardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.skinId = skin.id;
      card.querySelector('.skin-card__preview img').src = getAssetUrl(skin.preview);
      card.querySelector('.skin-card__name').textContent = skin.name;
      card.querySelector('.skin-card__description').textContent = skin.description;
      card.addEventListener('click', () => void selectSkin(skin.id));
      fragment.appendChild(card);
    }

    skinList.replaceChildren(fragment);
    refreshControls();
  }

  /** 从共享注册表生成效果开关。 */
  function renderEffectOptions() {
    const fragment = document.createDocumentFragment();

    for (const effect of effectRegistry.effects) {
      const option = effectOptionTemplate.content.firstElementChild.cloneNode(true);
      const toggle = option.querySelector('.effect-option__toggle');
      option.querySelector('.effect-option__name').textContent = effect.name;
      option.querySelector('.effect-option__description').textContent = effect.description;
      toggle.dataset.effectId = effect.id;
      toggle.addEventListener('change', () => {
        void setEffectEnabled(effect.id, toggle.checked);
      });
      fragment.appendChild(option);
    }

    effectList.replaceChildren(fragment);
    refreshControls();
  }

  /** 读取已保存的皮肤和效果并初始化设置页。 */
  async function initialize() {
    if (!skinRegistry || !effectRegistry || !window.pluginConfig) {
      showStatus('桌宠设置接口不可用。', 'error');
      return;
    }

    const [storedSkinId, storedEffectIds] = await Promise.all([
      window.pluginConfig.get('skinId'),
      window.pluginConfig.get('enabledEffectIds'),
    ]);
    selectedSkinId = storedSkinId === undefined
      ? skinRegistry.defaultSkinId
      : String(storedSkinId);
    enabledEffectIds = new Set(
      effectRegistry.resolveEnabledEffectIds(storedEffectIds),
    );

    renderSkinOptions();
    renderEffectOptions();
    if (!skinRegistry.getSkin(selectedSkinId)) {
      showStatus('当前保存的皮肤未在注册表中声明。', 'error');
      return;
    }
    showStatus('当前设置已应用。', 'success');
  }

  void initialize();
})();
