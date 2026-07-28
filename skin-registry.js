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
    rows: 36,
  });

  const skins = Object.freeze([
    Object.freeze({
      id: 'classic-xiaoyi',
      name: '经典小易',
      description: '易标默认的蓝色小易形象。',
      spriteSheet: 'assets/pet-spritesheet.webp',
      preview: 'assets/icon.png',
    }),
    Object.freeze({
      id: 'sacred-sword-singer',
      name: '圣剑歌手',
      description: '黑发黑衣、手持紫色麦克风的毛绒小歌手。',
      spriteSheet: 'assets/skins/sacred-sword-singer/spritesheet.webp',
      preview: 'assets/skins/sacred-sword-singer/preview.png',
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
