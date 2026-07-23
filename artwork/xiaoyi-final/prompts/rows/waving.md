Create one horizontal animation strip for Codex pet `xiaoyi`, state `waving`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 4 full-body frames in one left-to-right row on flat pure yellow #FFFF00. Treat the row as 4 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: 唯一角色基准为用户确认的B3淡冰蓝软胶精灵：蓝青渐变水滴形身体、两只大眼、微笑、短手短脚、腹部淡冰蓝Q形圆环、内圈和三个气泡点。不得增加易字，不得改变腹部结构与颜色。角色适合160px桌宠显示。. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `3d-toy`: Stylized 3D toy mascot with smooth rounded forms, simple materials, clear silhouette, and no photoreal complexity. User style notes: 哑光软胶3D玩具质感，边缘清楚，造型紧凑，保持淡冰蓝腹部装饰，不增加道具。.
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Greeting loop: paw or limb down, raised, tilted, and returning in a friendly attention gesture.

State requirements:
- Show the greeting through paw, hand, wing, or limb pose only.
- Do not draw wave marks, motion arcs, lines, sparkles, symbols, or floating effects around the gesture.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
