import base64
from io import BytesIO
from pathlib import Path

import streamlit as st
from PIL import Image, ImageFilter

AVATAR_ASSET_DIR = Path(__file__).resolve().parent.parent / "avatar_assets"


def _asset_cache_key(path):
    """Cache key for a static avatar PNG: path + mtime + size.

    Only ever applied to files in avatar_assets/. These are shipped with the
    repo and are not user data, so a process-global cache is safe.
    """
    try:
        p = Path(path)
        if p.exists():
            return f"{p}:{p.stat().st_mtime_ns}:{p.stat().st_size}"
        return f"{p}:missing"
    except Exception:
        return str(path)

AVATAR_ASSETS = {
    "aesthetic": {
        1: AVATAR_ASSET_DIR / "aesthetic_stage_1.png",
        2: AVATAR_ASSET_DIR / "aesthetic_stage_2.png",
        3: AVATAR_ASSET_DIR / "aesthetic_stage_3.png",
        4: AVATAR_ASSET_DIR / "aesthetic_stage_4.png",
    },
    "mass": {
        1: AVATAR_ASSET_DIR / "mass_stage_1.png",
        2: AVATAR_ASSET_DIR / "mass_stage_2.png",
        3: AVATAR_ASSET_DIR / "mass_stage_3.png",
    },
    "hybrid": {
        1: AVATAR_ASSET_DIR / "hybrid_stage_1.png",
        2: AVATAR_ASSET_DIR / "hybrid_stage_2.png",
        3: AVATAR_ASSET_DIR / "hybrid_stage_3.png",
    },
}


@st.cache_data(ttl=3600, show_spinner=False)
def cached_img_to_base64(path_str, key=None):
    try:
        return base64.b64encode(Path(path_str).read_bytes()).decode("utf-8")
    except Exception:
        return ""


def img_to_base64(path):
    try:
        path = Path(path)
        if path.exists():
            cache_key = _asset_cache_key(path)
            return cached_img_to_base64(str(path), cache_key)
        return ""
    except Exception:
        return ""


@st.cache_resource(show_spinner=False)
def cached_avatar_image(path_str, key=None):
    return Image.open(Path(path_str)).convert("RGBA")


def get_avatar_image_object(path):
    """
    Return a PIL image for Streamlit st.image.
    Cached to avoid repeatedly decoding PNGs on every rerun.
    """
    try:
        path = Path(path)
        if path.exists():
            cache_key = _asset_cache_key(path)
            return cached_avatar_image(str(path), cache_key)
        return None
    except Exception:
        return None


@st.cache_data(ttl=3600, show_spinner=False)
def _cached_pil_to_base64(_img, cache_key):
    """Encode a PIL image to base64 PNG. `_img` is excluded from the hash
    (leading underscore); `cache_key` is what actually keys the cache."""
    try:
        buf = BytesIO()
        _img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        return ""


def pil_to_base64(img):
    """Base64-encode an in-memory PIL image (e.g. a locked silhouette)."""
    try:
        cache_key = f"{img.size}:{hash(img.tobytes())}"
        return _cached_pil_to_base64(img, cache_key)
    except Exception:
        return ""


def avatar_img_tag(source, *, css_class="", alt="Avatar"):
    """Return a single <img src="data:image/png;base64,..."> tag.

    Accepts a file path (str/Path) or an in-memory PIL image. Returning a
    tag -- rather than calling st.image -- lets a caller emit an entire card
    in ONE st.markdown call, so the image is a real child of its wrapper.
    Splitting a <div> across separate st.markdown calls does NOT work:
    Streamlit sanitizes each call independently and auto-closes the tag,
    producing an empty styled box plus an orphaned sibling image.

    Returns "" if the image cannot be loaded (caller decides the fallback).
    """
    try:
        if isinstance(source, Image.Image):
            b64 = pil_to_base64(source)
        else:
            b64 = img_to_base64(source)
        if not b64:
            return ""
        cls = f' class="{css_class}"' if css_class else ""
        return f'<img src="data:image/png;base64,{b64}"{cls} alt="{alt}" />'
    except Exception:
        return ""


# Avatar art is tall portrait (~350x800) with a transparent background.
# Sizes are expressed as a max-height on the <img>; the stage sizes to it.
AVATAR_SIZES = ("sm", "md", "lg")


def avatar_stage_html(
    source,
    *,
    rarity="common",
    size="md",
    locked=False,
    alt="Avatar",
    extra_class="",
):
    """Build the layered avatar stage as a single HTML string.

    Structure (all CSS-driven, no image files change):

        .ef-avatar-stage            positioning context + hover target
          .ef-avatar-aura           radial cyan aura, pulses behind character
          .ef-avatar-flare          rarity-tinted flicker, elite/legendary only
          .ef-avatar-ground         elliptical ground shadow, pulses in sync
          .ef-avatar-img            the PNG: idle float + breathing scale

    Returns "" when the image cannot be loaded so callers can fall back.
    """
    if size not in AVATAR_SIZES:
        size = "md"

    img = avatar_img_tag(source, css_class="ef-avatar-img", alt=alt)
    if not img:
        return ""

    rarity_class = f"rarity-{str(rarity).lower()}"
    state_class = "is-locked" if locked else "is-unlocked"
    classes = " ".join(
        c for c in ["ef-avatar-stage", f"size-{size}", rarity_class, state_class, extra_class] if c
    )

    return (
        f'<div class="{classes}">'
        f'<div class="ef-avatar-aura" aria-hidden="true"></div>'
        f'<div class="ef-avatar-flare" aria-hidden="true"></div>'
        f'<div class="ef-avatar-ground" aria-hidden="true"></div>'
        f"{img}"
        f"</div>"
    )


def make_locked_silhouette_image(img):
    """
    Convert a transparent PNG avatar into a true locked silhouette image.
    Cached to avoid reprocessing on every rerun.
    """
    try:
        img = img.convert("RGBA")
        alpha = img.getchannel("A")
        alpha_key = str(hash(alpha.tobytes()))
        return cached_locked_silhouette(img.size, alpha_key, img)
    except Exception:
        return img


@st.cache_resource(show_spinner=False)
def cached_locked_silhouette(size, alpha_key, img):
    try:
        img = img.convert("RGBA")
        alpha = img.getchannel("A")

        body = Image.new("RGBA", img.size, (0, 0, 0, 0))
        black = Image.new("RGBA", img.size, (0, 0, 0, 238))
        body = Image.composite(black, body, alpha)

        glow_large = alpha.filter(ImageFilter.GaussianBlur(14))
        glow_mid = alpha.filter(ImageFilter.GaussianBlur(6))
        outline = alpha.filter(ImageFilter.MaxFilter(9))

        cyan_large = Image.new("RGBA", img.size, (6, 182, 212, 95))
        cyan_mid = Image.new("RGBA", img.size, (56, 189, 248, 155))
        cyan_outline = Image.new("RGBA", img.size, (125, 211, 252, 210))
        empty = Image.new("RGBA", img.size, (0, 0, 0, 0))

        canvas = Image.new("RGBA", img.size, (0, 0, 0, 0))
        canvas.alpha_composite(Image.composite(cyan_large, empty, glow_large))
        canvas.alpha_composite(Image.composite(cyan_mid, empty, glow_mid))
        canvas.alpha_composite(Image.composite(cyan_outline, empty, outline))
        canvas.alpha_composite(body)
        return canvas
    except Exception:
        return img
