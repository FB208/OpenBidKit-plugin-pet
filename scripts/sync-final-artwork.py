#!/usr/bin/env python3
"""导出或重新合成易标桌宠最终成稿素材。"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 8
ATLAS_ROWS = 36
STATE_SPECS = {
    "idle": {"startRow": 0, "frames": 24, "durationMs": 160},
    "running-right": {"startRow": 3, "frames": 16, "durationMs": 60},
    "running-left": {"startRow": 5, "frames": 16, "durationMs": 60},
    "waving": {"startRow": 7, "frames": 16, "durationMs": 70},
    "jumping": {"startRow": 9, "frames": 16, "durationMs": 65},
    "failed": {"startRow": 11, "frames": 16, "durationMs": 90},
    "waiting": {"startRow": 13, "frames": 16, "durationMs": 80},
    "running": {"startRow": 15, "frames": 16, "durationMs": 60},
    "review": {"startRow": 17, "frames": 16, "durationMs": 80},
    "walking-right": {"startRow": 19, "frames": 24, "durationMs": 120},
    "walking-left": {"startRow": 22, "frames": 24, "durationMs": 120},
    "climbing-up": {"startRow": 25, "frames": 24, "durationMs": 110},
    "climbing-down": {"startRow": 28, "frames": 24, "durationMs": 110},
    "hanging-right": {"startRow": 31, "frames": 24, "durationMs": 120},
    "sleeping": {"startRow": 34, "frames": 16, "durationMs": 260},
}


def file_sha256(path: Path) -> str:
    """计算文件 SHA-256，记录成稿来源。"""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def frame_box(start_row: int, frame_index: int) -> tuple[int, int, int, int]:
    """计算动画帧在图集中的裁切区域。"""
    column = frame_index % COLUMNS
    row = start_row + frame_index // COLUMNS
    left = column * CELL_WIDTH
    top = row * CELL_HEIGHT
    return left, top, left + CELL_WIDTH, top + CELL_HEIGHT


def export_final(atlas_path: Path, output_dir: Path) -> None:
    """从正式图集导出可编辑的最终透明帧和无损图集。"""
    atlas = Image.open(atlas_path).convert("RGBA")
    expected_size = (COLUMNS * CELL_WIDTH, ATLAS_ROWS * CELL_HEIGHT)
    if atlas.size != expected_size:
        raise ValueError(f"图集尺寸应为 {expected_size}，实际为 {atlas.size}")

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_root = output_dir / "frames"
    frames_root.mkdir(parents=True, exist_ok=True)

    atlas.save(output_dir / "spritesheet.png", format="PNG", optimize=True)
    shutil.copy2(atlas_path, output_dir / "spritesheet.webp")

    total_frames = 0
    for state, spec in STATE_SPECS.items():
        state_dir = frames_root / state
        state_dir.mkdir(parents=True, exist_ok=True)
        for frame_index in range(spec["frames"]):
            frame = atlas.crop(frame_box(spec["startRow"], frame_index))
            frame.save(state_dir / f"{frame_index:02d}.png", format="PNG", optimize=True)
            total_frames += 1

    canonical = atlas.crop(frame_box(STATE_SPECS["idle"]["startRow"], 0))
    canonical.save(output_dir / "canonical-frame.png", format="PNG", optimize=True)

    manifest = {
        "sourceKind": "从最终正式图集精确拆分",
        "sourceAtlas": "../../assets/pet-spritesheet.webp",
        "sourceSha256": file_sha256(atlas_path),
        "atlas": {
            "width": atlas.width,
            "height": atlas.height,
            "columns": COLUMNS,
            "rows": ATLAS_ROWS,
            "cellWidth": CELL_WIDTH,
            "cellHeight": CELL_HEIGHT,
        },
        "totalFrames": total_frames,
        "states": STATE_SPECS,
        "notes": [
            "frames 下的 PNG 是当前最终成稿的透明生产帧，可直接逐帧修改。",
            "spritesheet.png 是当前正式 WebP 的无损可编辑版本。",
            "无法由成品图集反推出已删除的高清黄底生成条带和淘汰方案。",
        ],
    }
    (output_dir / "atlas-map.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    readme = """# 小易方案 A 最终成稿素材

此目录由正式运行图集 `assets/pet-spritesheet.webp` 精确拆分而成，只保留当前最终成稿。

- `canonical-frame.png`：最终角色基准帧。
- `frames/`：15 组动画，共 288 张 `192×208` 透明 PNG 帧。
- `spritesheet.png`：无损可编辑图集。
- `spritesheet.webp`：导出时的正式运行图集副本。
- `atlas-map.json`：帧数、起始行、速度及图集尺寸。

修改单帧后，可重新合成正式图集：

```powershell
python .\\scripts\\sync-final-artwork.py build `
  --source-dir .\\artwork\\xiaoyi-final `
  --output .\\assets\\pet-spritesheet.webp
```

注意：这里能精确恢复最终运行帧，但无法恢复已经删除的高清黄底生成条带和淘汰方案。
"""
    (output_dir / "README.md").write_text(readme, encoding="utf-8")


def build_final(source_dir: Path, output_path: Path) -> None:
    """从修改后的透明帧重新合成正式 WebP 图集。"""
    atlas = Image.new(
        "RGBA",
        (COLUMNS * CELL_WIDTH, ATLAS_ROWS * CELL_HEIGHT),
        (0, 0, 0, 0),
    )
    for state, spec in STATE_SPECS.items():
        for frame_index in range(spec["frames"]):
            frame_path = source_dir / "frames" / state / f"{frame_index:02d}.png"
            if not frame_path.is_file():
                raise FileNotFoundError(f"缺少动画帧：{frame_path}")
            frame = Image.open(frame_path).convert("RGBA")
            if frame.size != (CELL_WIDTH, CELL_HEIGHT):
                raise ValueError(f"{frame_path} 尺寸必须为 {CELL_WIDTH}×{CELL_HEIGHT}")
            left, top, _right, _bottom = frame_box(spec["startRow"], frame_index)
            atlas.alpha_composite(frame, (left, top))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(
        output_path,
        format="WEBP",
        lossless=True,
        quality=100,
        method=6,
        exact=True,
    )
    atlas.save(source_dir / "spritesheet.png", format="PNG", optimize=True)
    shutil.copy2(output_path, source_dir / "spritesheet.webp")


def main() -> None:
    """解析命令行并执行导出或重新合成。"""
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="从正式图集导出最终成稿素材")
    export_parser.add_argument("--atlas", required=True, type=Path)
    export_parser.add_argument("--output-dir", required=True, type=Path)

    build_parser = subparsers.add_parser("build", help="从最终透明帧重新合成正式图集")
    build_parser.add_argument("--source-dir", required=True, type=Path)
    build_parser.add_argument("--output", required=True, type=Path)

    args = parser.parse_args()
    if args.command == "export":
        export_final(args.atlas.resolve(), args.output_dir.resolve())
    else:
        build_final(args.source_dir.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
