"""Build the final animation frame map.

Outputs:
  sheet_clean.png — sprites.png with the WALK/RUN/BLOCK labels whited out
                    (they sat inside frame clusters; all other labels fall
                    outside every frame crop and can stay)
  frames.js       — const SHEET/ANIMS consumed by index.html over file://
  contact.png     — every final frame side by side for visual verification
"""
import numpy as np
from PIL import Image, ImageDraw

im = Image.open("sprites.png").convert("RGB")
d = ImageDraw.Draw(im)
for rect in [(525, 194, 588, 224),    # WALK
             (525, 370, 576, 401),    # RUN
             (966, 531, 1046, 558),   # BLOCK
             (22, 875, 86, 900),      # HURT
             (340, 875, 376, 900),    # KO
             (581, 875, 681, 900)]:   # VICTORY
    d.rectangle(rect, fill=(255, 255, 255))

# knock out the white background: flood-fill magic pink from the corners so
# only OUTSIDE white goes transparent — white highlights inside sprites survive
MAGIC = (255, 0, 255)
for corner in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
    ImageDraw.floodfill(im, corner, MAGIC, thresh=40)
rgba = np.asarray(im.convert("RGBA")).copy()
bg = (rgba[:, :, 0] == 255) & (rgba[:, :, 1] == 0) & (rgba[:, :, 2] == 255)
# grow transparency through near-white pixels (AA fences seal white pockets
# between the legs that corner flood-fill can't reach); stops at dark outlines
nearwhite = rgba[:, :, :3].astype(int).sum(axis=2) > 665
while True:
    grow = np.zeros_like(bg)
    for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
        grow |= np.roll(bg, sh, axis=ax)
    grow &= nearwhite & ~bg
    if not grow.any():
        break
    bg |= grow
# enclosed pockets (between legs etc.) never connect to the outside: blank any
# remaining near-white component that is color-NEUTRAL and ringed by DARK pixels.
# Projectile / orb cores are ringed by bright cyan glow and survive both tests.
from collections import deque as _dq
rgb = rgba[:, :, :3].astype(int)
ssum = rgb.sum(axis=2)
spread = rgb.max(axis=2) - rgb.min(axis=2)
cand = ~bg & (ssum > 665)
seen = np.zeros_like(cand)
Hh, Ww = cand.shape
for yy, xx in zip(*np.nonzero(cand)):
    if seen[yy, xx]:
        continue
    comp = []
    q = _dq([(yy, xx)])
    seen[yy, xx] = True
    while q:
        cy, cx = q.popleft()
        comp.append((cy, cx))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < Hh and 0 <= nx < Ww and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    if len(comp) < 4:
        continue
    cy, cx = zip(*comp)
    ring = []
    for py, px in comp:
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = py + dy, px + dx
            if 0 <= ny < Hh and 0 <= nx < Ww and not cand[ny, nx] and not bg[ny, nx]:
                ring.append(ssum[ny, nx])
    if spread[cy, cx].mean() < 25 and ring and np.mean(ring) < 500:
        bg[cy, cx] = True
# eat the pale AA fence around blanked pockets (2 steps, neutral pixels only)
fence_ok = (ssum > 560) & (spread <= 25)
for _ in range(2):
    grow = np.zeros_like(bg)
    for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
        grow |= np.roll(bg, sh, axis=ax)
    grow &= fence_ok & ~bg
    bg |= grow
rgba[bg] = (0, 0, 0, 0)
Image.fromarray(rgba).save("sheet_clean.png")
im = Image.open("sprites.png").convert("RGB")  # detection still runs on the labeled-but-opaque copy
d = ImageDraw.Draw(im)
for rect in [(525, 194, 588, 224), (525, 370, 576, 401), (966, 531, 1046, 558),
             (22, 875, 86, 900), (340, 875, 376, 900), (581, 875, 681, 900)]:
    d.rectangle(rect, fill=(255, 255, 255))

arr = np.asarray(im).astype(int)
mask = (arr.sum(axis=2) < 720) | (arr.std(axis=2) > 18)

def tight(x0, y0, x1, y1):
    sub = mask[y0:y1, x0:x1]
    ys, xs = np.nonzero(sub)
    if len(ys) == 0:
        raise SystemExit(f"empty segment {(x0, y0, x1, y1)}")
    return (int(x0 + xs.min()), int(y0 + ys.min()),
            int(x0 + xs.max() + 1), int(y0 + ys.max() + 1))

# segments: (x0, x1) within a shared row band (y0, y1)
def row(y0, y1, xsplits):
    return [tight(a, y0, b, y1) for a, b in zip(xsplits, xsplits[1:])]

ANIMS = {
    "idle":    {"fps": 8,  "mode": "loop", "boxes": row(20, 176, [589, 670, 800, 925, 1055, 1190, 1314])},
    "walk":    {"fps": 10, "mode": "loop", "boxes": row(198, 355, [529, 668, 786, 906, 1028, 1155, 1277, 1397, 1511])},
    "run":     {"fps": 12, "mode": "loop", "boxes": row(370, 510, [529, 681, 839, 990]) +
                                                    row(370, 510, [1002, 1165, 1301, 1414, 1531])},
    "jump":    {"fps": 10, "mode": "once", "boxes": [tight(94, 480, 174, 670), tight(214, 480, 317, 670),
                                                     tight(345, 480, 438, 670), tight(449, 480, 534, 670)]},
    "crouch":  {"fps": 10, "mode": "hold", "boxes": row(560, 682, [609, 690, 790, 879])},
    "block":   {"fps": 10, "mode": "hold", "boxes": row(558, 686, [966, 1110, 1234, 1344])},
    "punch":   {"fps": 12, "mode": "once", "boxes": row(720, 852, [25, 123, 240, 379])},
    "kick":    {"fps": 12, "mode": "once", "boxes": row(720, 852, [417, 520, 645, 792])},
    "special": {"fps": 10, "mode": "once", "boxes": row(720, 855, [855, 958, 1075, 1178, 1290])},
    "projectile": {"fps": 12, "mode": "loop", "boxes": row(720, 855, [1290, 1405, 1501])},
    "hurt":    {"fps": 8,  "mode": "once", "boxes": row(880, 1010, [69, 167, 280])},
    "ko":      {"fps": 6,  "mode": "hold", "boxes": [tight(353, 880, 523, 1012)]},
    "victory": {"fps": 6,  "mode": "loop", "boxes": row(880, 1014, [593, 660, 760, 837])},
}

# per-animation baseline: bottom-align frames but keep in-row height offsets
# (jump apex, victory fist pump). dy = how far ABOVE the baseline this frame sits.
js = {}
for name, a in ANIMS.items():
    base = max(b[3] for b in a["boxes"])
    js[name] = {
        "fps": a["fps"], "mode": a["mode"],
        "frames": [{"x": b[0], "y": b[1], "w": b[2] - b[0], "h": b[3] - b[1],
                    "dy": base - b[3]} for b in a["boxes"]],
    }

pad = 6
maxh = max(b[3] - b[1] for a in ANIMS.values() for b in a["boxes"])
totw = sum(b[2] - b[0] + pad for a in ANIMS.values() for b in a["boxes"]) + pad
contact = Image.new("RGB", (totw, maxh + 30), (24, 26, 34))
cd = ImageDraw.Draw(contact)
cx = pad
for name, a in ANIMS.items():
    cd.text((cx, maxh + 8), name.upper(), fill=(120, 220, 255))
    for b in a["boxes"]:
        w, h = b[2] - b[0], b[3] - b[1]
        contact.paste(im.crop(b), (cx, maxh - h))
        cd.rectangle([cx, maxh - h, cx + w - 1, maxh - 1], outline=(70, 70, 90))
        cx += w + pad
contact.save("contact.png")

import json
with open("frames.js", "w") as f:
    f.write("// generated by build_frames.py — do not edit by hand\n")
    f.write('const SHEET_SRC = "sheet_clean.png";\n')
    f.write("const ANIMS = " + json.dumps(js, indent=1) + ";\n")

for name, a in js.items():
    print(f"{name:11s} {len(a['frames'])} frames  " +
          " ".join(f"{fr['w']}x{fr['h']}" for fr in a["frames"]))
