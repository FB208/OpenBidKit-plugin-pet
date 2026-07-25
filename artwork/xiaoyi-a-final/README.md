# 小易方案 A 最终成稿素材

此目录由正式运行图集 `assets/pet-spritesheet.webp` 精确拆分而成，只保留当前最终成稿。

- `canonical-frame.png`：最终角色基准帧。
- `frames/`：9 组动画，共 152 张 `192×208` 透明 PNG 帧。
- `spritesheet.png`：无损可编辑图集。
- `spritesheet.webp`：导出时的正式运行图集副本。
- `atlas-map.json`：帧数、起始行、速度及图集尺寸。

修改单帧后，可重新合成正式图集：

```powershell
python .\scripts\sync-final-artwork.py build `
  --source-dir .\artwork\xiaoyi-a-final `
  --output .\assets\pet-spritesheet.webp
```

注意：这里能精确恢复最终运行帧，但无法恢复已经删除的高清黄底生成条带和淘汰方案。
