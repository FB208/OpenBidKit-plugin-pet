(function initializePetSkinRegistry(root, createRegistry) {
  const registry = createRegistry();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = registry;
  }

  if (root) {
    root.openBidKitPetSkins = registry;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const atlas = Object.freeze({
    columns: 8,
    rows: 19,
  });

  const skins = Object.freeze([
    Object.freeze({
      id: 'classic-xiaoyi',
      name: '经典小易',
      description: '易标默认的蓝色小易形象。',
      spriteSheet: 'assets/pet-spritesheet.webp',
      preview: 'assets/icon.png',
    }),
  ]);

  const defaultSkinId = 'classic-xiaoyi';

  /** 按稳定标识读取已注册的皮肤。 */
  function getSkin(skinId) {
    return skins.find((skin) => skin.id === skinId) || null;
  }

  return Object.freeze({
    atlas,
    skins,
    defaultSkinId,
    getSkin,
  });
});
