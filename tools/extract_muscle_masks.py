# -*- coding: utf-8 -*-
"""
MUSCLE MASKS — extract Tyson's hand-drawn Krita mask layers into the app's
overlay assets (2026-07-15).

The .kra is the SOURCE OF TRUTH: nothing here redraws, reinterprets or
approximates the artwork. A .kra is a ZIP whose paint layers are Krita's
tiled format — VERSION-2 headers, 64×64 LZF-compressed tiles, PLANAR BGRA
channel order (all B bytes, then G, R, A — interleaved was the first bug).
The decoder is PROVEN before any export is trusted: recompositing every
decoded layer bottom-to-top must be pixel-identical to the file's own
mergedimage.png (it was: max diff 0 over all 1,573,538 px).

Outputs, per completed muscle layer:
  client/assets/muscle-masks/<view>/<view>-<muscle>.png       exact, as drawn
  client/assets/muscle-masks/<view>/lit/<view>-<muscle>-lit.png
    display variant: the white fill becomes EvoForge neon cyan (#18D9FF),
    the black linework stays black. RN's tintColor would recolour the
    linework too — pre-tinting at export time is the simplest compositing
    that preserves it, with zero runtime dependencies.

Usage:
  python tools/extract_muscle_masks.py "<path to .kra>" <front|back> [--base-proof <layer-name> <reference.png>]

Proof ladder (the tool refuses to export unproven):
  1. mergedimage.png present -> full recomposite must be pixel-identical.
  2. else, previously-proven exports on disk -> those layers must decode
     pixel-identically from this file.
  3. else, --base-proof -> the named layer (the imported base art) must
     decode pixel-identical to the reference PNG it came from.
"""
import io
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
CANVAS = (887, 1774)  # must match the base silhouettes exactly
CYAN = (0x18, 0xD9, 0xFF)

# muscle id -> acceptable Krita layer names (lowercased, separators
# normalised), first match wins. Inspect maindoc.xml before assuming: the
# drawn names vary in case and separator (front-triceps, front_chest,
# Front_abs, ...) and the quads currently live on an unrenamed layer.
LAYER_MAP = {
    "front": {
        "triceps": ["front-triceps"],
        "shoulders": ["front-shoulders"],
        "chest": ["front-chest"],
        "abs": ["front-abs"],
        "traps": ["front-traps"],
        "forearms": ["front-forearms"],
        "biceps": ["front-biceps"],
        "obliques": ["front-obliques"],
        "quads": ["front-quads"],
        "abductors": ["front-abductors"],
        "adductors": ["front-adductors"],
        "calves": ["front-calves"],
    },
    "back": {
        "shoulders": ["back-reardelts", "back-shoulders", "rear-delts"],
        "triceps": ["rear-triceps", "back-triceps"],
        "traps": ["rear-traps", "back-traps"],
    },
}


def lzf_decompress(data: bytes, expected: int) -> bytes:
    """liblzf decompression — the algorithm Krita's KisLzfCompression uses."""
    out = bytearray()
    ip, n = 0, len(data)
    while ip < n:
        ctrl = data[ip]
        ip += 1
        if ctrl < 32:  # literal run
            run = ctrl + 1
            out += data[ip : ip + run]
            ip += run
        else:  # back reference
            length = ctrl >> 5
            if length == 7:
                length += data[ip]
                ip += 1
            ref = len(out) - ((ctrl & 0x1F) << 8) - data[ip] - 1
            ip += 1
            length += 2
            for _ in range(length):  # may self-overlap — byte-by-byte on purpose
                out.append(out[ref])
                ref += 1
    if len(out) != expected:
        raise ValueError(f"LZF size mismatch: {len(out)} != {expected}")
    return bytes(out)


def decode_layer(blob: bytes, w: int, h: int) -> np.ndarray:
    """One 'layerN' file -> full-canvas straight-alpha RGBA array."""
    st = io.BytesIO(blob)
    header = {}
    for _ in range(5):
        k, v = st.readline().decode("ascii").strip().split(" ", 1)
        header[k] = v
    if header["VERSION"] != "2" or header["PIXELSIZE"] != "4":
        raise ValueError(f"unsupported layer format: {header}")
    tw, th = int(header["TILEWIDTH"]), int(header["TILEHEIGHT"])
    canvas = np.zeros((h, w, 4), dtype=np.uint8)
    for _ in range(int(header["DATA"])):
        left, top, comp, size = st.readline().decode("ascii").strip().split(",")
        left, top, size = int(left), int(top), int(size)
        if comp != "LZF":
            raise ValueError(f"unsupported tile compression {comp}")
        payload = st.read(size)
        raw = lzf_decompress(payload[1:], tw * th * 4) if payload[0] == 1 else payload[1:]
        # PLANAR tiles: all B bytes, all G, all R, all A.
        planes = np.frombuffer(raw, dtype=np.uint8).reshape(4, th, tw)
        tile = np.stack([planes[2], planes[1], planes[0], planes[3]], axis=-1)
        dx0, dy0 = max(0, left), max(0, top)
        dx1, dy1 = min(w, left + tw), min(h, top + th)
        if dx1 <= dx0 or dy1 <= dy0:
            continue
        canvas[dy0:dy1, dx0:dx1] = tile[dy0 - top : dy1 - top, dx0 - left : dx1 - left]
    return canvas


def alpha_over(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    sa = src[..., 3:4].astype(np.float32) / 255.0
    da = dst[..., 3:4].astype(np.float32) / 255.0
    oa = sa + da * (1 - sa)
    safe = np.where(oa == 0, 1, oa)
    out = np.zeros_like(dst)
    out[..., :3] = np.clip((src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / safe + 0.5, 0, 255).astype(np.uint8)
    out[..., 3:4] = np.clip(oa * 255 + 0.5, 0, 255).astype(np.uint8)
    return out


def lit_variant(arr: np.ndarray) -> np.ndarray:
    """White fill -> neon cyan; the dark linework keeps its own colour."""
    out = arr.copy()
    vis = arr[..., 3] > 0
    lum = (
        arr[..., 0].astype(np.int64) * 299 + arr[..., 1].astype(np.int64) * 587 + arr[..., 2].astype(np.int64) * 114
    ) // 1000
    fill = vis & (lum >= 128)
    out[fill, 0], out[fill, 1], out[fill, 2] = CYAN
    return out


def main() -> None:
    kra_path, view = sys.argv[1], sys.argv[2]
    layer_map = LAYER_MAP[view]
    w, h = CANVAS
    z = zipfile.ZipFile(kra_path)

    doc = ElementTree.fromstring(z.read("maindoc.xml"))
    ns = {"k": "http://www.calligra.org/DTD/krita"}
    image = doc.find("k:IMAGE", ns)
    if (int(image.get("width")), int(image.get("height"))) != (w, h):
        raise SystemExit(f"canvas is {image.get('width')}x{image.get('height')}, expected {w}x{h}")

    nodes = {}  # normalised layer name -> (filename, raw name)
    stack = []  # bottom-to-top filenames, for the merged-image proof
    opacities = {}  # filename -> layer opacity 0..255 (Tyson dims the base while tracing)
    for lay in image.iter("{http://www.calligra.org/DTD/krita}layer"):
        if lay.get("nodetype") != "paintlayer":
            continue
        norm = lay.get("name").strip().lower().replace("_", "-").replace(" ", "-")
        nodes[norm] = (lay.get("filename"), lay.get("name"))
        stack.insert(0, lay.get("filename"))  # maindoc lists top-first
        opacities[lay.get("filename")] = int(lay.get("opacity", "255"))

    decoded = {fn: decode_layer(z.read(f"Unnamed/layers/{fn}"), w, h) for fn, _ in nodes.values()}
    dest = REPO / "client" / "assets" / "muscle-masks" / view

    # THE PROOF: our decode, recomposited, must equal Krita's own flatten.
    # Autosave files (.kra-autosave.kra) carry NO mergedimage.png — for those
    # the fallback proof is equivalence: every layer whose exact export
    # already exists on disk (proven from the main file) must decode
    # pixel-identically from this file too. Same decoder, same layers,
    # re-proven — only then are NEW layers trusted.
    if "mergedimage.png" in z.namelist():
        merged = np.array(Image.open(io.BytesIO(z.read("mergedimage.png"))).convert("RGBA"))
        acc = np.zeros((h, w, 4), dtype=np.uint8)
        for fn in stack:
            src = decoded[fn]
            if opacities.get(fn, 255) != 255:  # layer opacity scales its alpha
                src = src.copy()
                src[..., 3] = (src[..., 3].astype(np.uint16) * opacities[fn] // 255).astype(np.uint8)
            acc = alpha_over(acc, src)
        diff = np.abs(acc.astype(np.int16) - merged.astype(np.int16))
        visible = np.maximum(acc[..., 3], merged[..., 3]) > 0
        max_diff = int(diff[..., 3].max()), int(diff[..., :3].max(axis=2)[visible].max())
        if max(max_diff) > 0:
            raise SystemExit(f"decode does NOT reproduce mergedimage.png (max diffs {max_diff}) — refusing to export")
        print(f"decode proven: recomposite == mergedimage.png exactly ({len(stack)} layers)")
    else:
        proven = 0
        for muscle, candidates in layer_map.items():
            existing = dest / f"{view}-{muscle}.png"
            norm = next((c for c in candidates if c in nodes), None)
            if norm is None or not existing.exists():
                continue
            prior = np.array(Image.open(existing).convert("RGBA"))
            if not np.array_equal(prior, decoded[nodes[norm][0]]):
                raise SystemExit(f"'{muscle}' decodes DIFFERENTLY from the proven export — refusing")
            proven += 1
        if proven >= 3:
            print(f"decode proven by equivalence: {proven} previously-proven layers pixel-identical")
        elif "--base-proof" in sys.argv:
            i = sys.argv.index("--base-proof")
            base_layer, ref_path = sys.argv[i + 1], sys.argv[i + 2]
            norm = base_layer.strip().lower().replace("_", "-").replace(" ", "-")
            if norm not in nodes:
                raise SystemExit(f"base-proof layer '{base_layer}' not found; available: {sorted(nodes)}")
            ref = np.array(Image.open(ref_path).convert("RGBA"))
            if not np.array_equal(ref, decoded[nodes[norm][0]]):
                raise SystemExit(f"'{base_layer}' does NOT decode identical to {ref_path} — refusing")
            print(f"decode proven: layer '{base_layer}' pixel-identical to its source PNG")
        else:
            raise SystemExit(
                f"no mergedimage.png, only {proven} previously-proven layers, no --base-proof — refusing"
            )
    (dest / "lit").mkdir(parents=True, exist_ok=True)
    for muscle, candidates in layer_map.items():
        norm = next((c for c in candidates if c in nodes), None)
        if norm is None:
            raise SystemExit(f"no layer for '{muscle}' (tried {candidates}); available: {sorted(nodes)}")
        arr = decoded[nodes[norm][0]]
        if not (arr[..., 3] > 0).any():
            raise SystemExit(f"layer '{nodes[norm][1]}' for '{muscle}' is EMPTY — refusing to export")
        Image.fromarray(arr).save(dest / f"{view}-{muscle}.png")
        Image.fromarray(lit_variant(arr)).save(dest / "lit" / f"{view}-{muscle}-lit.png")
        print(f"exported {view}-{muscle}.png (+lit) from layer '{nodes[norm][1]}'")


if __name__ == "__main__":
    main()
