#!/usr/bin/env python3
"""Build the plugin atlas from generated phase strips, seamless cycle strips, or 4×4 action grids."""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 8
FRAMES_PER_STATE = 16
CHROMA_KEY = (255, 255, 0)
CHROMA_SOFT_START = 32.0
CHROMA_OPAQUE_DISTANCE = 280.0
GROUND_BASELINE = 202
CENTER_X = 95.5
CENTER_Y = 103.5
EDGE_PADDING = 4
LEFT_EDGE_STATES = {"climbing-up"}
RIGHT_EDGE_STATES = {"climbing-down"}
TOP_EDGE_STATES = {"hanging-right"}
MAX_SPRITE_WIDTH = 182
MAX_SPRITE_HEIGHT = 198
STABLE_CYCLE_UNIQUE_FRAMES = 8
STABLE_CYCLE_STATES = {"walking-right", "climbing-up", "climbing-down"}

STATE_ORDER = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review",
    "walking-right",
    "walking-left",
    "climbing-up",
    "climbing-down",
    "hanging-right",
]
GENERATED_STATES = [state for state in STATE_ORDER if state != "running-left"]
STATE_FRAME_COUNTS = {state: (24 if state == "idle" else FRAMES_PER_STATE) for state in STATE_ORDER}
STATE_PHASES = {state: ("a", "b") for state in GENERATED_STATES}
STATE_PHASES["idle"] = ("a", "b", "c")
STATE_START_ROWS: dict[str, int] = {}
_next_atlas_row = 0
for _state in STATE_ORDER:
    STATE_START_ROWS[_state] = _next_atlas_row
    _next_atlas_row += math.ceil(STATE_FRAME_COUNTS[_state] / COLUMNS)
ATLAS_ROWS = _next_atlas_row
FRAME_DURATIONS_MS = {
    "idle": 160,
    "running-right": 60,
    "running-left": 60,
    "waving": 70,
    "jumping": 65,
    "failed": 90,
    "waiting": 80,
    "running": 60,
    "review": 80,
    "walking-right": 90,
    "walking-left": 90,
    "climbing-up": 80,
    "climbing-down": 80,
    "hanging-right": 90,
}
JUMP_BASELINES = [202, 201, 199, 197, 195, 193, 191, 189, 189, 191, 193, 195, 197, 199, 201, 202]
IMAGE_SUFFIXES = {".png", ".webp", ".jpg", ".jpeg"}


def color_distance(red: int, green: int, blue: int) -> float:
    """计算像素与黄色抠图背景的欧氏距离。"""
    return math.sqrt(
        (red - CHROMA_KEY[0]) ** 2
        + (green - CHROMA_KEY[1]) ** 2
        + (blue - CHROMA_KEY[2]) ** 2
    )


def remove_chroma_background(image: Image.Image) -> Image.Image:
    """用软色键移除黄色背景，并反算边缘前景色以消除黄绿色溢色。"""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            distance = color_distance(red, green, blue)
            coverage = (distance - CHROMA_SOFT_START) / (
                CHROMA_OPAQUE_DISTANCE - CHROMA_SOFT_START
            )
            coverage = max(0.0, min(1.0, coverage))
            if coverage <= 0.0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if coverage >= 1.0:
                continue

            background_fraction = 1.0 - coverage
            foreground_red = round((red - background_fraction * CHROMA_KEY[0]) / coverage)
            foreground_green = round((green - background_fraction * CHROMA_KEY[1]) / coverage)
            foreground_blue = round((blue - background_fraction * CHROMA_KEY[2]) / coverage)
            pixels[x, y] = (
                max(0, min(255, foreground_red)),
                max(0, min(255, foreground_green)),
                max(0, min(255, foreground_blue)),
                round(alpha * coverage),
            )
    return rgba


def connected_components(image: Image.Image) -> list[dict[str, object]]:
    """查找透明背景上的连通图像组件。"""
    alpha = image.getchannel("A")
    width, height = image.size
    data = alpha.tobytes()
    visited = bytearray(width * height)
    components: list[dict[str, object]] = []

    for start, alpha_value in enumerate(data):
        if alpha_value <= 16 or visited[start]:
            continue

        stack = [start]
        visited[start] = 1
        indexes: list[int] = []
        min_x = width
        min_y = height
        max_x = 0
        max_y = 0

        while stack:
            current = stack.pop()
            indexes.append(current)
            x = current % width
            y = current // width
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

            if x > 0:
                neighbor = current - 1
                if not visited[neighbor] and data[neighbor] > 16:
                    visited[neighbor] = 1
                    stack.append(neighbor)
            if x + 1 < width:
                neighbor = current + 1
                if not visited[neighbor] and data[neighbor] > 16:
                    visited[neighbor] = 1
                    stack.append(neighbor)
            if y > 0:
                neighbor = current - width
                if not visited[neighbor] and data[neighbor] > 16:
                    visited[neighbor] = 1
                    stack.append(neighbor)
            if y + 1 < height:
                neighbor = current + width
                if not visited[neighbor] and data[neighbor] > 16:
                    visited[neighbor] = 1
                    stack.append(neighbor)

        components.append(
            {
                "pixels": indexes,
                "area": len(indexes),
                "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                "center_x": (min_x + max_x + 1) / 2,
            }
        )
    return components


def group_frame_components(image: Image.Image, frame_count: int = 8) -> list[list[dict[str, object]]]:
    """把角色主体和眼睛等小组件归并为八个从左到右的姿态。"""
    components = connected_components(image)
    if not components:
        raise ValueError("strip contains no non-background components")

    largest_area = max(int(component["area"]) for component in components)
    seed_threshold = max(120, largest_area * 0.20)
    seeds = [component for component in components if int(component["area"]) >= seed_threshold]
    if len(seeds) < frame_count:
        seeds = sorted(components, key=lambda item: int(item["area"]), reverse=True)[:frame_count]
    if len(seeds) < frame_count:
        raise ValueError(f"expected {frame_count} poses, found only {len(seeds)} large components")

    seeds = sorted(
        sorted(seeds, key=lambda item: int(item["area"]), reverse=True)[:frame_count],
        key=lambda item: float(item["center_x"]),
    )
    seed_ids = {id(seed) for seed in seeds}
    groups: list[list[dict[str, object]]] = [[seed] for seed in seeds]
    noise_threshold = max(12, largest_area * 0.002)

    for component in components:
        if id(component) in seed_ids or int(component["area"]) < noise_threshold:
            continue
        nearest_index = min(
            range(len(seeds)),
            key=lambda index: abs(float(seeds[index]["center_x"]) - float(component["center_x"])),
        )
        groups[nearest_index].append(component)
    return groups


def crop_component_group(image: Image.Image, components: list[dict[str, object]], padding: int = 3) -> Image.Image:
    """从条带中提取一个完整角色姿态。"""
    width, height = image.size
    min_x = max(0, min(int(item["bbox"][0]) for item in components) - padding)
    min_y = max(0, min(int(item["bbox"][1]) for item in components) - padding)
    max_x = min(width, max(int(item["bbox"][2]) for item in components) + padding)
    max_y = min(height, max(int(item["bbox"][3]) for item in components) + padding)

    output = Image.new("RGBA", (max_x - min_x, max_y - min_y), (0, 0, 0, 0))
    source_pixels = image.load()
    output_pixels = output.load()
    for component in components:
        for pixel_index in component["pixels"]:
            x = int(pixel_index) % width
            y = int(pixel_index) // width
            output_pixels[x - min_x, y - min_y] = source_pixels[x, y]
    return output


def split_strip_at_vertical_valleys(image: Image.Image, frame_count: int = 8) -> list[Image.Image]:
    """在相邻姿态发生轻微粘连时，沿角色之间最窄的竖向谷值切开条带。"""
    alpha = image.getchannel("A")
    column_counts = [
        sum(1 for y in range(image.height) if alpha.getpixel((x, y)) > 16)
        for x in range(image.width)
    ]
    active_columns = [x for x, count in enumerate(column_counts) if count >= 4]
    if not active_columns:
        raise ValueError("strip contains no foreground columns")

    left = active_columns[0]
    right = active_columns[-1] + 1
    slot_width = (right - left) / frame_count
    boundaries = [left]

    for index in range(1, frame_count):
        ideal = left + slot_width * index
        search_radius = max(8, round(slot_width * 0.22))
        search_start = max(boundaries[-1] + 1, round(ideal - search_radius))
        search_end = min(right - 1, round(ideal + search_radius))
        candidates = range(search_start, search_end + 1)
        cut = min(
            candidates,
            key=lambda x: (
                sum(column_counts[max(0, x - 1) : min(image.width, x + 2)]),
                abs(x - ideal),
            ),
        )
        boundaries.append(cut)
    boundaries.append(right)

    frames: list[Image.Image] = []
    for index in range(frame_count):
        segment = image.crop((boundaries[index], 0, boundaries[index + 1], image.height))
        components = connected_components(segment)
        if not components:
            raise ValueError(f"frame slot {index + 1} contains no pose")
        largest_area = max(int(component["area"]) for component in components)
        noise_threshold = max(12, largest_area * 0.002)
        pose_components = [
            component for component in components if int(component["area"]) >= noise_threshold
        ]
        frames.append(crop_component_group(segment, pose_components))
    return frames


def extract_phase_strip(path: Path) -> list[Image.Image]:
    """从一张生成条带中按原始相对尺寸提取八个姿态。"""
    with Image.open(path) as opened:
        transparent = remove_chroma_background(opened)
    try:
        groups = group_frame_components(transparent, 8)
        return [crop_component_group(transparent, group) for group in groups]
    except ValueError:
        return split_strip_at_vertical_valleys(transparent, 8)

def extract_stable_cycle_frames(path: Path, state: str, frame_count: int) -> list[Image.Image]:
    """用八帧共用的裁剪框、缩放比例和锚点构建稳定循环。"""
    with Image.open(path) as opened:
        transparent = remove_chroma_background(opened)

    slots: list[Image.Image] = []
    pose_boxes: list[tuple[int, int, int, int]] = []
    for index in range(STABLE_CYCLE_UNIQUE_FRAMES):
        slot_left = round(index * transparent.width / STABLE_CYCLE_UNIQUE_FRAMES)
        slot_right = round((index + 1) * transparent.width / STABLE_CYCLE_UNIQUE_FRAMES)
        slot = transparent.crop((slot_left, 0, slot_right, transparent.height))
        cleaned_slot = keep_components_in_place(slot, select_pose_components(slot))
        pose_box = cleaned_slot.getbbox()
        if pose_box is None:
            raise ValueError(f"{state} cycle slot {index:02d} is empty")
        slots.append(cleaned_slot)
        pose_boxes.append(pose_box)

    padding = 4
    common_box = (
        max(0, min(box[0] for box in pose_boxes) - padding),
        max(0, min(box[1] for box in pose_boxes) - padding),
        min(slots[0].width, max(box[2] for box in pose_boxes) + padding),
        min(slots[0].height, max(box[3] for box in pose_boxes) + padding),
    )
    common_width = common_box[2] - common_box[0]
    common_height = common_box[3] - common_box[1]
    scale = min(MAX_SPRITE_WIDTH / common_width, MAX_SPRITE_HEIGHT / common_height)
    canvas_width = max(1, round(common_width * scale))
    canvas_height = max(1, round(common_height * scale))

    cycle_frames: list[Image.Image] = []
    for slot in slots:
        canvas = slot.crop(common_box).resize(
            (canvas_width, canvas_height),
            Image.Resampling.LANCZOS,
        )
        if state in LEFT_EDGE_STATES:
            left = EDGE_PADDING
            top = round((CELL_HEIGHT - canvas_height) / 2)
        elif state in RIGHT_EDGE_STATES:
            left = CELL_WIDTH - EDGE_PADDING - canvas_width
            top = round((CELL_HEIGHT - canvas_height) / 2)
        elif state in TOP_EDGE_STATES:
            left = round((CELL_WIDTH - canvas_width) / 2)
            top = EDGE_PADDING
        else:
            left = round((CELL_WIDTH - canvas_width) / 2)
            top = GROUND_BASELINE - canvas_height + 1
        if left < 0 or top < 0 or left + canvas_width > CELL_WIDTH or top + canvas_height > CELL_HEIGHT:
            raise ValueError(f"{state} stable cycle canvas exceeds the cell")
        cell = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        cell.alpha_composite(canvas, (left, top))
        cycle_frames.append(clear_transparent_rgb(cell))

    if frame_count % len(cycle_frames) != 0:
        raise ValueError(
            f"cycle frame count {len(cycle_frames)} cannot evenly fill {frame_count} frames"
        )
    return [
        cycle_frames[index % len(cycle_frames)].copy()
        for index in range(frame_count)
    ]

def select_pose_components(image: Image.Image) -> list[dict[str, object]]:
    """保留主体及邻近身份组件，排除从相邻格切入的边缘碎片。"""
    components = connected_components(image)
    if not components:
        raise ValueError("frame contains no foreground components")

    main_component = max(components, key=lambda item: int(item["area"]))
    main_bbox = main_component["bbox"]
    main_area = int(main_component["area"])
    minimum_area = max(8, round(main_area * 0.0004))
    main_width = int(main_bbox[2]) - int(main_bbox[0])
    main_height = int(main_bbox[3]) - int(main_bbox[1])
    proximity_limit = max(10, round(min(main_width, main_height) * 0.12))
    selected = [main_component]

    for component in components:
        if component is main_component or int(component["area"]) < minimum_area:
            continue
        bbox = component["bbox"]
        touches_slot_edge = (
            int(bbox[0]) <= 1
            or int(bbox[1]) <= 1
            or int(bbox[2]) >= image.width - 1
            or int(bbox[3]) >= image.height - 1
        )
        if touches_slot_edge:
            continue
        horizontal_gap = max(int(main_bbox[0]) - int(bbox[2]), int(bbox[0]) - int(main_bbox[2]), 0)
        vertical_gap = max(int(main_bbox[1]) - int(bbox[3]), int(bbox[1]) - int(main_bbox[3]), 0)
        if horizontal_gap <= proximity_limit and vertical_gap <= proximity_limit:
            selected.append(component)
    return selected


def keep_components_in_place(
    image: Image.Image,
    components: list[dict[str, object]],
) -> Image.Image:
    """按原坐标复制选中的连通组件。"""
    source = image.convert("RGBA")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_pixels = source.load()
    output_pixels = output.load()
    for component in components:
        for pixel_index in component["pixels"]:
            x = int(pixel_index) % source.width
            y = int(pixel_index) // source.width
            output_pixels[x, y] = source_pixels[x, y]
    return clear_transparent_rgb(output)


def remove_cross_slot_fragments(image: Image.Image) -> Image.Image:
    """移除动作格边缘处不属于当前角色的跨格碎片。"""
    return keep_components_in_place(image, select_pose_components(image))


def extract_contact_grid(path: Path, columns: int = 4, rows: int = 4) -> list[Image.Image]:
    """从四乘四动作联系图按阅读顺序提取十六个姿态。"""
    with Image.open(path) as opened:
        transparent = remove_chroma_background(opened)
    frames: list[Image.Image] = []
    for row in range(rows):
        top = round(row * transparent.height / rows)
        bottom = round((row + 1) * transparent.height / rows)
        for column in range(columns):
            left = round(column * transparent.width / columns)
            right = round((column + 1) * transparent.width / columns)
            slot = transparent.crop((left, top, right, bottom))
            cleaned_slot = remove_cross_slot_fragments(slot)
            bbox = cleaned_slot.getbbox()
            if bbox is None:
                raise ValueError(f"contact grid slot {row * columns + column + 1} is empty")
            padding = 3
            crop_box = (
                max(0, bbox[0] - padding),
                max(0, bbox[1] - padding),
                min(cleaned_slot.width, bbox[2] + padding),
                min(cleaned_slot.height, bbox[3] + padding),
            )
            frames.append(cleaned_slot.crop(crop_box))
    return frames


def alpha_area(image: Image.Image) -> int:
    """统计有效角色像素数量。"""
    return sum(1 for value in image.getchannel("A").getdata() if value > 16)


def alpha_centroid_x(image: Image.Image) -> float:
    """计算透明度加权的水平视觉质心。"""
    alpha = image.getchannel("A")
    total = 0
    weighted = 0
    for y in range(alpha.height):
        for x in range(alpha.width):
            value = alpha.getpixel((x, y))
            total += value
            weighted += x * value
    return weighted / total if total else image.width / 2


def resize_by_scale(image: Image.Image, scale: float) -> Image.Image:
    """按统一比例缩放角色姿态。"""
    width = max(1, round(image.width * scale))
    height = max(1, round(image.height * scale))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def alpha_centroid_y(image: Image.Image) -> float:
    """计算透明度加权的垂直视觉质心。"""
    alpha = image.getchannel("A")
    total = 0
    weighted = 0
    for y in range(alpha.height):
        for x in range(alpha.width):
            value = alpha.getpixel((x, y))
            total += value
            weighted += y * value
    return weighted / total if total else image.height / 2


def normalize_state_frames(state: str, frames: list[Image.Image]) -> list[Image.Image]:
    """统一一个状态全部帧的角色体量、中心和脚底基线。"""
    expected_frames = STATE_FRAME_COUNTS[state]
    if len(frames) != expected_frames:
        raise ValueError(f"{state} requires {expected_frames} frames, got {len(frames)}")

    areas = [max(1, alpha_area(frame)) for frame in frames]
    target_area = statistics.median(areas)
    area_normalized: list[Image.Image] = []
    minimum_correction, maximum_correction = (0.90, 1.10) if state == "failed" else (0.85, 1.15)
    for frame, area in zip(frames, areas):
        correction = math.sqrt(target_area / area)
        correction = max(minimum_correction, min(maximum_correction, correction))
        area_normalized.append(resize_by_scale(frame, correction))

    max_width = max(frame.width for frame in area_normalized)
    max_height = max(frame.height for frame in area_normalized)
    global_scale = min(MAX_SPRITE_WIDTH / max_width, MAX_SPRITE_HEIGHT / max_height)
    scaled = [resize_by_scale(frame, global_scale) for frame in area_normalized]

    normalized: list[Image.Image] = []
    for index, frame in enumerate(scaled):
        bbox = frame.getbbox()
        if bbox is None:
            raise ValueError(f"{state} frame {index:02d} is empty after extraction")
        sprite = frame.crop(bbox)
        centroid_x = alpha_centroid_x(sprite)
        centroid_y = alpha_centroid_y(sprite)
        if state in LEFT_EDGE_STATES:
            left = EDGE_PADDING
            top = round(CENTER_Y - centroid_y)
        elif state in RIGHT_EDGE_STATES:
            left = CELL_WIDTH - sprite.width - EDGE_PADDING
            top = round(CENTER_Y - centroid_y)
        elif state in TOP_EDGE_STATES:
            left = round(CENTER_X - centroid_x)
            top = EDGE_PADDING
        else:
            baseline = JUMP_BASELINES[index] if state == "jumping" else GROUND_BASELINE
            left = round(CENTER_X - centroid_x)
            top = baseline - sprite.height + 1
        left = max(0, min(left, CELL_WIDTH - sprite.width))
        top = max(0, min(top, CELL_HEIGHT - sprite.height))
        if left < 0 or left + sprite.width > CELL_WIDTH or top < 0 or top + sprite.height > CELL_HEIGHT:
            raise ValueError(
                f"{state} frame {index:02d} exceeds cell after normalization: "
                f"size={sprite.width}x{sprite.height}, position={left},{top}"
            )
        cell = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        cell.alpha_composite(sprite, (left, top))
        normalized.append(clear_transparent_rgb(cell))

    # 待命动作最后一帧与静止首帧完全一致，消除回落时的尺寸跳变。
    if state == "idle":
        normalized[-1] = normalized[0].copy()
    return normalized


def clear_transparent_rgb(image: Image.Image) -> Image.Image:
    """清除全透明像素内的隐藏RGB，避免缩放边缘出现色边。"""
    rgba = image.convert("RGBA")
    data = bytearray(rgba.tobytes())
    for index in range(0, len(data), 4):
        if data[index + 3] == 0:
            data[index] = 0
            data[index + 1] = 0
            data[index + 2] = 0
    return Image.frombytes("RGBA", rgba.size, bytes(data))


def mirror_frames(frames: list[Image.Image]) -> list[Image.Image]:
    """逐帧镜像右向步态，保留原时间顺序。"""
    return [ImageOps.mirror(frame) for frame in frames]


def load_existing_atlas_frames(path: Path) -> dict[str, list[Image.Image]]:
    """从现有正式图集读取仍需原样保留的动作帧。"""
    with Image.open(path) as opened:
        atlas = opened.convert("RGBA")
    if atlas.width != COLUMNS * CELL_WIDTH or atlas.height % CELL_HEIGHT != 0:
        raise ValueError(f"现有图集尺寸不符合 {COLUMNS} 列、{CELL_WIDTH}×{CELL_HEIGHT} 单帧约定")

    available_rows = atlas.height // CELL_HEIGHT
    all_frames: dict[str, list[Image.Image]] = {}
    for state in STATE_ORDER:
        frame_count = STATE_FRAME_COUNTS[state]
        start_row = STATE_START_ROWS[state]
        required_rows = math.ceil(frame_count / COLUMNS)
        if start_row + required_rows > available_rows:
            continue
        frames: list[Image.Image] = []
        for frame_index in range(frame_count):
            column = frame_index % COLUMNS
            row = start_row + frame_index // COLUMNS
            box = (
                column * CELL_WIDTH,
                row * CELL_HEIGHT,
                (column + 1) * CELL_WIDTH,
                (row + 1) * CELL_HEIGHT,
            )
            frames.append(clear_transparent_rgb(atlas.crop(box)))
        all_frames[state] = frames
    return all_frames


def frame_metrics(image: Image.Image, index: int) -> dict[str, object]:
    """采集单帧边界、面积、质心与基线指标。"""
    bbox = image.getbbox()
    if bbox is None:
        return {"index": index, "empty": True}
    alpha = image.getchannel("A")
    total = 0
    weighted_x = 0
    weighted_y = 0
    area = 0
    for y in range(alpha.height):
        for x in range(alpha.width):
            value = alpha.getpixel((x, y))
            if value > 16:
                area += 1
            total += value
            weighted_x += x * value
            weighted_y += y * value
    return {
        "index": index,
        "bbox": list(bbox),
        "width": bbox[2] - bbox[0],
        "height": bbox[3] - bbox[1],
        "baseline": bbox[3] - 1,
        "alpha_area": area,
        "centroid_x": round(weighted_x / total, 3),
        "centroid_y": round(weighted_y / total, 3),
    }


def validate_geometry(all_frames: dict[str, list[Image.Image]]) -> list[str]:
    """按地面、侧边和顶部动作各自的对齐方式检查帧几何。"""
    errors: list[str] = []
    for state, frames in all_frames.items():
        metrics = [frame_metrics(frame, index) for index, frame in enumerate(frames)]
        if any(metric.get("empty") for metric in metrics):
            errors.append(f"{state}: contains empty frame")
            continue
        areas = [int(metric["alpha_area"]) for metric in metrics]
        average_area = sum(areas) / len(areas)
        area_delta = (max(areas) - min(areas)) / average_area
        # 失败姿态会逐步蜷缩并遮挡四肢，面积变化属于动作语义；其体型改由逐帧视觉检查确认。
        if state == "failed":
            area_limit = 0.25
        elif state in STABLE_CYCLE_STATES:
            area_limit = 0.10
        else:
            area_limit = 0.05
        if area_delta > area_limit:
            errors.append(
                f"{state}: alpha-area variation {area_delta:.1%} exceeds {area_limit:.0%}"
            )
        if state in STABLE_CYCLE_STATES:
            if len(frames) % STABLE_CYCLE_UNIQUE_FRAMES != 0:
                errors.append(f"{state}: stable cycle does not fill the formal frame count")
            elif any(
                frames[index].tobytes() != frames[index + STABLE_CYCLE_UNIQUE_FRAMES].tobytes()
                for index in range(STABLE_CYCLE_UNIQUE_FRAMES)
            ):
                errors.append(f"{state}: repeated cycle frames are not pixel-identical")
            boxes = [metric["bbox"] for metric in metrics]
            if any(
                int(box[0]) <= 0
                or int(box[1]) <= 0
                or int(box[2]) >= CELL_WIDTH
                or int(box[3]) >= CELL_HEIGHT
                for box in boxes
            ):
                errors.append(f"{state}: sprite content touches a cell boundary")
            if state == "walking-right":
                baselines = [int(metric["baseline"]) for metric in metrics]
                if max(baselines) - min(baselines) > 2:
                    errors.append(f"{state}: foot-baseline variation exceeds 2px")
            continue
        if state in LEFT_EDGE_STATES:
            left_edges = [int(metric["bbox"][0]) for metric in metrics]
            vertical_centers = [float(metric["centroid_y"]) for metric in metrics]
            if left_edges != [EDGE_PADDING] * len(frames):
                errors.append(f"{state}: left-edge alignment does not match the geometry contract")
            if max(vertical_centers) - min(vertical_centers) > 1.5:
                errors.append(f"{state}: vertical visual-center variation exceeds 1.5px")
        elif state in RIGHT_EDGE_STATES:
            right_edges = [int(metric["bbox"][2]) for metric in metrics]
            vertical_centers = [float(metric["centroid_y"]) for metric in metrics]
            if right_edges != [CELL_WIDTH - EDGE_PADDING] * len(frames):
                errors.append(f"{state}: right-edge alignment does not match the geometry contract")
            if max(vertical_centers) - min(vertical_centers) > 1.5:
                errors.append(f"{state}: vertical visual-center variation exceeds 1.5px")
        else:
            centers = [float(metric["centroid_x"]) for metric in metrics]
            if max(centers) - min(centers) > 1.5:
                errors.append(f"{state}: horizontal visual-center variation exceeds 1.5px")
            if state in TOP_EDGE_STATES:
                top_edges = [int(metric["bbox"][1]) for metric in metrics]
                if top_edges != [EDGE_PADDING] * len(frames):
                    errors.append(f"{state}: top-edge alignment does not match the geometry contract")
            else:
                baselines = [int(metric["baseline"]) for metric in metrics]
                expected = JUMP_BASELINES if state == "jumping" else [GROUND_BASELINE] * len(frames)
                if baselines != expected:
                    errors.append(f"{state}: baseline sequence does not match the geometry contract")
    return errors

def write_frames(frames_root: Path, state: str, frames: list[Image.Image]) -> None:
    """保存一个状态的十六张标准化真实帧。"""
    state_dir = frames_root / state
    state_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(state_dir / f"{index:02d}.png")


def compose_atlas(all_frames: dict[str, list[Image.Image]]) -> Image.Image:
    """按状态实际帧数、每行八帧合成扩展图集。"""
    atlas = Image.new(
        "RGBA",
        (COLUMNS * CELL_WIDTH, ATLAS_ROWS * CELL_HEIGHT),
        (0, 0, 0, 0),
    )
    for state in STATE_ORDER:
        for frame_index, frame in enumerate(all_frames[state]):
            row = STATE_START_ROWS[state] + frame_index // COLUMNS
            column = frame_index % COLUMNS
            atlas.alpha_composite(frame, (column * CELL_WIDTH, row * CELL_HEIGHT))
    return clear_transparent_rgb(atlas)

def checkerboard(size: tuple[int, int], square: int = 12) -> Image.Image:
    """创建用于视觉复核透明边缘的棋盘背景。"""
    output = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(output)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=(225, 229, 235))
    return output


def make_contact_sheet(
    all_frames: dict[str, list[Image.Image]],
    output: Path,
    *,
    dark_background: bool = False,
) -> None:
    """生成当前构建所含全部帧的逐帧检查表。"""
    states = [state for state in STATE_ORDER if state in all_frames]
    scale = 0.5
    thumb_w = round(CELL_WIDTH * scale)
    thumb_h = round(CELL_HEIGHT * scale)
    label_w = 118
    row_h = thumb_h + 22
    max_frames = max(len(all_frames[state]) for state in states)
    sheet = Image.new("RGB", (label_w + thumb_w * max_frames, row_h * len(states)), (25, 28, 35))
    draw = ImageDraw.Draw(sheet)
    for row_index, state in enumerate(states):
        top = row_index * row_h
        draw.text((8, top + 8), state, fill="white")
        for frame_index, frame in enumerate(all_frames[state]):
            cell_bg = (
                Image.new("RGBA", (thumb_w, thumb_h), (15, 23, 42, 255))
                if dark_background
                else checkerboard((thumb_w, thumb_h), square=8).convert("RGBA")
            )
            thumb = frame.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            cell_bg.alpha_composite(thumb)
            left = label_w + frame_index * thumb_w
            sheet.paste(cell_bg.convert("RGB"), (left, top))
            draw.text((left + 3, top + thumb_h + 2), f"{frame_index:02d}", fill=(210, 215, 225))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def make_onion_sheet(all_frames: dict[str, list[Image.Image]], output: Path) -> None:
    """生成相邻帧半透明叠放检查表，仅用于发现尺寸和锚点跳变。"""
    states = [state for state in STATE_ORDER if state in all_frames]
    scale = 0.5
    thumb_w = round(CELL_WIDTH * scale)
    thumb_h = round(CELL_HEIGHT * scale)
    label_w = 118
    row_h = thumb_h + 22
    max_frames = max(len(all_frames[state]) for state in states)
    sheet = Image.new("RGB", (label_w + thumb_w * max_frames, row_h * len(states)), (25, 28, 35))
    draw = ImageDraw.Draw(sheet)
    for row_index, state in enumerate(states):
        top = row_index * row_h
        draw.text((8, top + 8), state, fill="white")
        frames = all_frames[state]
        for frame_index, current in enumerate(frames):
            previous = frames[(frame_index - 1) % len(frames)]
            background = checkerboard((CELL_WIDTH, CELL_HEIGHT)).convert("RGBA")
            previous_layer = previous.copy()
            previous_layer.putalpha(previous_layer.getchannel("A").point(lambda value: round(value * 0.42)))
            current_layer = current.copy()
            current_layer.putalpha(current_layer.getchannel("A").point(lambda value: round(value * 0.58)))
            background.alpha_composite(previous_layer)
            background.alpha_composite(current_layer)
            thumb = background.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            left = label_w + frame_index * thumb_w
            sheet.paste(thumb.convert("RGB"), (left, top))
            previous_index = (frame_index - 1) % len(frames)
            draw.text((left + 3, top + thumb_h + 2), f"{previous_index:02d}>{frame_index:02d}", fill=(210, 215, 225))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def save_state_qa_sheets(all_frames: dict[str, list[Image.Image]], output_dir: Path) -> None:
    """为每个状态生成四列全尺寸逐帧表，便于逐张核对边界和体型。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    columns = 4
    label_height = 24
    for state, frames in all_frames.items():
        rows = math.ceil(len(frames) / columns)
        sheet = Image.new(
            "RGB",
            (columns * CELL_WIDTH, rows * (CELL_HEIGHT + label_height)),
            (25, 28, 35),
        )
        draw = ImageDraw.Draw(sheet)
        for index, frame in enumerate(frames):
            column = index % columns
            row = index // columns
            left = column * CELL_WIDTH
            top = row * (CELL_HEIGHT + label_height)
            background = checkerboard((CELL_WIDTH, CELL_HEIGHT)).convert("RGBA")
            background.alpha_composite(frame)
            sheet.paste(background.convert("RGB"), (left, top))
            draw.text((left + 6, top + CELL_HEIGHT + 4), f"{state} {index:02d}", fill=(220, 225, 235))
        sheet.save(output_dir / f"{state}.png")

def save_previews(all_frames: dict[str, list[Image.Image]], output_dir: Path) -> None:
    """为每个状态生成十六帧循环GIF。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    for state, frames in all_frames.items():
        duration = FRAME_DURATIONS_MS[state]
        frames[0].save(
            output_dir / f"{state}.gif",
            save_all=True,
            append_images=frames[1:],
            duration=[duration] * len(frames),
            loop=0,
            disposal=2,
            optimize=False,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--states", default="all", help="Comma-separated generated states for checkpoint builds.")
    parser.add_argument("--base-atlas", type=Path, help="需要原样保留旧动作的现有正式图集。")
    parser.add_argument("--skip-qa", action="store_true", help="仅合成成稿，不生成检查材料。")
    args = parser.parse_args()
    run_dir = Path(args.run_dir).expanduser().resolve()
    decoded_dir = run_dir / "decoded"
    frames_root = run_dir / "frames"
    final_dir = run_dir / "final"
    qa_dir = run_dir / "qa"
    all_frames: dict[str, list[Image.Image]] = (
        load_existing_atlas_frames(args.base_atlas.expanduser().resolve()) if args.base_atlas else {}
    )
    selected_states = GENERATED_STATES if args.states == "all" else [
        item.strip() for item in args.states.split(",") if item.strip()
    ]
    unknown_states = sorted(set(selected_states) - set(GENERATED_STATES))
    if unknown_states:
        raise SystemExit(f"unknown generated states: {', '.join(unknown_states)}")

    for state in selected_states:
        cycle_path = decoded_dir / f"{state}-cycle.png"
        contact_grid_path = decoded_dir / f"{state}.png"
        if cycle_path.is_file():
            all_frames[state] = extract_stable_cycle_frames(
                cycle_path,
                state,
                STATE_FRAME_COUNTS[state],
            )
            continue
        elif contact_grid_path.is_file():
            raw_frames = extract_contact_grid(contact_grid_path)
        else:
            phase_paths = [
                decoded_dir / f"{state}-{suffix}.png"
                for suffix in STATE_PHASES[state]
            ]
            missing_phases = [path for path in phase_paths if not path.is_file()]
            if missing_phases:
                raise SystemExit(
                    f"缺少 {state} 的八帧循环条带、4×4联系图或八帧分段图："
                    + ", ".join(str(path) for path in missing_phases)
                )
            raw_frames = []
            for phase_path in phase_paths:
                raw_frames.extend(extract_phase_strip(phase_path))
        all_frames[state] = normalize_state_frames(state, raw_frames)

    if "running-right" in selected_states:
        all_frames["running-left"] = mirror_frames(all_frames["running-right"])

    for state in STATE_ORDER:
        if state in all_frames:
            write_frames(frames_root, state, all_frames[state])

    checkpoint_only = any(state not in all_frames for state in STATE_ORDER)
    atlas = None if checkpoint_only else compose_atlas(all_frames)
    final_dir.mkdir(parents=True, exist_ok=True)
    if atlas is not None:
        atlas.save(final_dir / "spritesheet-hd.png")
        atlas.save(
            final_dir / "spritesheet-hd.webp",
            format="WEBP",
            lossless=True,
            quality=100,
            method=6,
            exact=True,
        )

    validation_state_names = set(selected_states)
    if "running-right" in validation_state_names:
        validation_state_names.add("running-left")
    validation_frames = {
        state: all_frames[state]
        for state in validation_state_names
        if state in all_frames
    }
    geometry_errors = [] if args.skip_qa else validate_geometry(validation_frames)
    geometry = {
        "ok": not geometry_errors,
        "errors": geometry_errors,
        "validated_states": sorted(validation_frames),
        "atlas": {
            "columns": COLUMNS,
            "rows": ATLAS_ROWS,
            "cell_width": CELL_WIDTH,
            "cell_height": CELL_HEIGHT,
            "width": atlas.width if atlas is not None else 0,
            "height": atlas.height if atlas is not None else 0,
        },
        "states": {
            state: [frame_metrics(frame, index) for index, frame in enumerate(all_frames[state])]
            for state in STATE_ORDER
            if state in all_frames
        },
    }
    if not args.skip_qa:
        qa_dir.mkdir(parents=True, exist_ok=True)
        geometry_name = "geometry.json" if not checkpoint_only else "geometry-checkpoint.json"
        (qa_dir / geometry_name).write_text(
            json.dumps(geometry, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        contact_name = "contact-sheet-hd.png" if not checkpoint_only else "contact-sheet-checkpoint.png"
        onion_name = "onion-sheet-hd.png" if not checkpoint_only else "onion-sheet-checkpoint.png"
        make_contact_sheet(all_frames, qa_dir / contact_name)
        if not checkpoint_only:
            make_contact_sheet(
                all_frames,
                qa_dir / "contact-sheet-dark.png",
                dark_background=True,
            )
        make_onion_sheet(all_frames, qa_dir / onion_name)
        save_state_qa_sheets(all_frames, qa_dir / "state-sheets")
        save_previews(all_frames, qa_dir / "previews")

    metadata = {
        "columns": COLUMNS,
        "rows": ATLAS_ROWS,
        "cellWidth": CELL_WIDTH,
        "cellHeight": CELL_HEIGHT,
        "frameCounts": STATE_FRAME_COUNTS,
        "stateStartRows": STATE_START_ROWS,
        "stateOrder": STATE_ORDER,
        "frameDurationsMs": FRAME_DURATIONS_MS,
    }
    (final_dir / "spritesheet-hd.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "ok": not geometry_errors,
                "run_dir": str(run_dir),
                "checkpoint_only": checkpoint_only,
                "atlas": str(final_dir / "spritesheet-hd.webp") if not checkpoint_only else None,
            },
            indent=2,
        )
    )


    if geometry_errors and not args.skip_qa:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
