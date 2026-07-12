"""Auto-detect sprite frame bounding boxes on the Cyber Athlete sheet.

The sheet is NOT a regular grid: frames sit in labeled clusters on a white
background. Strategy:
  1. mask = pixels that are not near-white
  2. connected components on a 4x-downscaled mask (fast pure-python BFS)
  3. refine each box at full resolution
  4. merge boxes that overlap / nearly touch (dust, glow fx belong to a frame)
  5. drop text labels & palette chips by size/aspect heuristics
  6. write debug_overlay.png and boxes.json for manual group assignment
"""
import json
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

SCALE = 4
im = Image.open("sprites.png").convert("RGB")
W, H = im.size
arr = np.asarray(im).astype(int)

# near-white background removal (JPEG-ish noise tolerance)
mask = (arr.sum(axis=2) < 720) | (arr.std(axis=2) > 18)

small = mask[::SCALE, ::SCALE]
sh, sw = small.shape
visited = np.zeros_like(small, dtype=bool)
boxes = []
for sy in range(sh):
    for sx in range(sw):
        if small[sy, sx] and not visited[sy, sx]:
            q = deque([(sy, sx)])
            visited[sy, sx] = True
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < sh and 0 <= nx < sw and small[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            q.append((ny, nx))
            if n >= 4:  # ignore lone specks
                boxes.append([x0 * SCALE, y0 * SCALE, (x1 + 1) * SCALE, (y1 + 1) * SCALE])

def merge_pass(boxes, gap):
    merged = True
    while merged:
        merged = False
        out = []
        while boxes:
            a = boxes.pop()
            changed = True
            while changed:
                changed = False
                keep = []
                for b in boxes:
                    if not (a[2] + gap < b[0] or b[2] + gap < a[0] or
                            a[3] + gap < b[1] or b[3] + gap < a[1]):
                        a = [min(a[0], b[0]), min(a[1], b[1]),
                             max(a[2], b[2]), max(a[3], b[3])]
                        changed = True
                        merged = True
                    else:
                        keep.append(b)
                boxes = keep
            out.append(a)
        boxes = out
    return boxes

boxes = merge_pass(boxes, gap=6)

# refine at full resolution
refined = []
for x0, y0, x1, y1 in boxes:
    x0, y0 = max(0, x0 - SCALE), max(0, y0 - SCALE)
    x1, y1 = min(W, x1 + SCALE), min(H, y1 + SCALE)
    sub = mask[y0:y1, x0:x1]
    ys, xs = np.nonzero(sub)
    if len(ys) == 0:
        continue
    refined.append([int(x0 + xs.min()), int(y0 + ys.min()),
                    int(x0 + xs.max() + 1), int(y0 + ys.max() + 1)])
boxes = merge_pass(refined, gap=4)
boxes.sort(key=lambda b: (b[1] // 80, b[0]))

overlay = im.copy()
d = ImageDraw.Draw(overlay)
for i, (x0, y0, x1, y1) in enumerate(boxes):
    d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 0, 0), width=2)
    d.text((x0 + 2, y0 + 2), str(i), fill=(255, 0, 255))
overlay.save("debug_overlay.png")

with open("boxes.json", "w") as f:
    json.dump(boxes, f, indent=1)
print(f"{len(boxes)} boxes")
for i, b in enumerate(boxes):
    print(i, b, "w=%d h=%d" % (b[2] - b[0], b[3] - b[1]))
