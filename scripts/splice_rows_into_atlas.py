#!/usr/bin/env python3
"""将一张条带图（strip）局部替换进现有精灵图集的指定行区域。

用法示例：
  python scripts/splice_rows_into_atlas.py \
    --atlas assets/skins/sacred-sword-singer/spritesheet.webp \
    --strip artwork/sacred-sword-singer/repair/decoded/walking-right.png \
    --start-row 19 \
    --row-count 3 \
    --output artwork/sacred-sword-singer/repair/spritesheet-new.webp
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
ATLAS_COLUMNS = 8


def splice(
    atlas_path: Path,
    strip_path: Path,
    start_row: int,
    row_count: int,
    output_path: Path,
    resize_strip: bool,
) -> None:
    """读取现有图集，将条带覆盖到指定行区域后写出新图集。"""
    with Image.open(atlas_path) as img:
        atlas = img.convert("RGBA")

    atlas_rows = atlas.height // CELL_HEIGHT
    if start_row + row_count > atlas_rows:
        raise SystemExit(
            f"图集共 {atlas_rows} 行，起始行 {start_row} + 行数 {row_count} 超出范围"
        )

    with Image.open(strip_path) as img:
        strip = img.convert("RGBA")

    expected_w = ATLAS_COLUMNS * CELL_WIDTH
    expected_h = row_count * CELL_HEIGHT
    if strip.width != expected_w or strip.height != expected_h:
        expected_ratio = expected_w / expected_h
        actual_ratio = strip.width / strip.height
        if not resize_strip or abs(expected_ratio - actual_ratio) > 0.01:
            raise SystemExit(
                f"条带尺寸应为 {expected_w}×{expected_h}，实际为 {strip.width}×{strip.height}"
            )
        strip = strip.resize((expected_w, expected_h), Image.Resampling.LANCZOS)

    # 先清空目标区域（全透明），再粘贴新条带
    top = start_row * CELL_HEIGHT
    clear = Image.new("RGBA", (expected_w, expected_h), (0, 0, 0, 0))
    atlas.paste(clear, (0, top))
    atlas.alpha_composite(strip, (0, top))

    # 确保透明像素的 RGB 通道归零（避免隐藏残留）
    data = bytearray(atlas.tobytes())
    for i in range(0, len(data), 4):
        if data[i + 3] == 0:
            data[i] = data[i + 1] = data[i + 2] = 0
    atlas = Image.frombytes("RGBA", atlas.size, bytes(data))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(
        output_path,
        format="WEBP",
        lossless=True,
        quality=100,
        method=6,
        exact=True,
    )
    print(f"已写出: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--atlas", required=True, help="现有图集路径（WebP/PNG）")
    parser.add_argument("--strip", required=True, help="替换条带图路径（PNG/WebP）")
    parser.add_argument("--start-row", type=int, required=True, help="替换起始行号（0-based）")
    parser.add_argument("--row-count", type=int, required=True, help="替换行数")
    parser.add_argument("--output", required=True, help="输出图集路径")
    parser.add_argument(
        "--resize-strip",
        action="store_true",
        help="条带宽高比一致时，将其缩放到目标行尺寸",
    )
    args = parser.parse_args()

    splice(
        atlas_path=Path(args.atlas).expanduser().resolve(),
        strip_path=Path(args.strip).expanduser().resolve(),
        start_row=args.start_row,
        row_count=args.row_count,
        output_path=Path(args.output).expanduser().resolve(),
        resize_strip=args.resize_strip,
    )


if __name__ == "__main__":
    main()
