"""Inspect the fused boxes: print column-occupancy valleys and save crops."""
import json
import numpy as np
from PIL import Image

im = Image.open("sprites.png").convert("RGB")
arr = np.asarray(im).astype(int)
mask = (arr.sum(axis=2) < 720) | (arr.std(axis=2) > 18)
boxes = json.load(open("boxes.json"))

for idx in (20, 21, 30, 46):
    x0, y0, x1, y1 = boxes[idx]
    col = mask[y0:y1, x0:x1].sum(axis=0)
    im.crop((x0, y0, x1, y1)).save(f"crop_{idx}.png")
    # report runs of columns with low occupancy (candidate split points)
    lo = col <= 6
    runs = []
    start = None
    for i, v in enumerate(lo):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start + x0, i + x0, int(col[start:i].max())))
            start = None
    if start is not None:
        runs.append((start + x0, len(lo) + x0, int(col[start:].max())))
    print(idx, boxes[idx], "valleys:", [r for r in runs if r[1] - r[0] >= 2])
