(() => {
  const registry = window.openBidKitPetSkins;
  const skinList = document.getElementById('skinList');
  const saveStatus = document.getElementById('saveStatus');
  const cardTemplate = document.getElementById('skinCardTemplate');

  let selectedSkinId = null;
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

  /** 根据当前选择状态刷新所有皮肤卡片。 */
  function refreshCards() {
    for (const card of skinList.querySelectorAll('.skin-card')) {
      const selected = card.dataset.skinId === selectedSkinId;
      card.setAttribute('aria-checked', String(selected));
      card.disabled = saveInProgress;
    }
  }

  /** 保存皮肤选择，并由主程序即时通知运行中的桌宠。 */
  async function selectSkin(skinId) {
    if (saveInProgress || skinId === selectedSkinId) return;

    saveInProgress = true;
    refreshCards();
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
      refreshCards();
    }
  }

  /** 从共享注册表生成皮肤选项。 */
  function renderSkinOptions() {
    const fragment = document.createDocumentFragment();

    for (const skin of registry.skins) {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.skinId = skin.id;
      card.querySelector('.skin-card__preview img').src = getAssetUrl(skin.preview);
      card.querySelector('.skin-card__name').textContent = skin.name;
      card.querySelector('.skin-card__description').textContent = skin.description;
      card.addEventListener('click', () => void selectSkin(skin.id));
      fragment.appendChild(card);
    }

    skinList.replaceChildren(fragment);
    refreshCards();
  }

  /** 读取已保存的皮肤并初始化设置页。 */
  async function initialize() {
    if (!registry || !window.pluginConfig) {
      showStatus('皮肤设置接口不可用。', 'error');
      return;
    }

    const storedSkinId = await window.pluginConfig.get('skinId');
    selectedSkinId = storedSkinId === undefined
      ? registry.defaultSkinId
      : String(storedSkinId);

    renderSkinOptions();
    if (!registry.getSkin(selectedSkinId)) {
      showStatus('当前保存的皮肤未在注册表中声明。', 'error');
      return;
    }
    showStatus('当前皮肤已应用。', 'success');
  }

  void initialize();
})();
