import base64
from io import BytesIO
from pathlib import Path

import streamlit as st
from PIL import Image, ImageFilter

from data.csv_store import _cache_key_for_path

AVATAR_ASSET_DIR = Path(__file__).resolve().parent.parent / "avatar_assets"

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
            cache_key = _cache_key_for_path(path)
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
            cache_key = _cache_key_for_path(path)
            return cached_avatar_image(str(path), cache_key)
        return None
    except Exception:
        return None


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
