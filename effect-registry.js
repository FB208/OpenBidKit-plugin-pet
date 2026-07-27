(function initializePetEffectRegistry(root, createRegistry) {
  const registry = createRegistry();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = registry;
  }

  if (root) {
    root.openBidKitPetEffects = registry;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const effects = Object.freeze([
    Object.freeze({
      id: 'edge-patrol',
      name: '瞎溜达',
      description: '持续待命 10 秒后，走向屏幕边缘并沿多屏桌面顺时针巡边。',
      defaultEnabled: true,
    }),
  ]);

  const defaultEnabledEffectIds = Object.freeze(
    effects.filter((effect) => effect.defaultEnabled).map((effect) => effect.id),
  );

  /** 按稳定标识读取已注册的效果。 */
  function getEffect(effectId) {
    return effects.find((effect) => effect.id === effectId) || null;
  }

  /** 解析已启用效果列表；未保存配置时使用注册表默认值。 */
  function resolveEnabledEffectIds(value) {
    const source = value === undefined ? defaultEnabledEffectIds : value;
    if (!Array.isArray(source)) {
      throw new Error('桌宠效果配置必须是数组');
    }

    const requestedIds = new Set(source.map((effectId) => String(effectId)));
    for (const effectId of requestedIds) {
      if (!getEffect(effectId)) {
        throw new Error(`未注册的桌宠效果: ${effectId}`);
      }
    }

    return effects
      .filter((effect) => requestedIds.has(effect.id))
      .map((effect) => effect.id);
  }

  return Object.freeze({
    effects,
    defaultEnabledEffectIds,
    getEffect,
    resolveEnabledEffectIds,
  });
});
