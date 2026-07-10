from pathlib import Path

import streamlit as st

STYLES_PATH = Path(__file__).resolve().parent.parent / "assets" / "styles.css"


def _styles_cache_key(path):
    """Path + mtime + size, so an edited stylesheet is picked up on the next run.

    Mirrors `ui/avatar_images.py :: _asset_cache_key`.
    """
    try:
        stat = path.stat()
        return f"{path}:{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        return str(path)


@st.cache_data(ttl=3600, show_spinner=False)
def _read_styles(path_str, cache_key=None):
    """The stylesheet text.

    A process-global cache is safe here and ONLY here: `assets/styles.css` ships
    with the repo, is identical for every user, and contains no user data. Never
    cache anything per-user this way -- `st.cache_data` is shared by every browser
    session in the process. See tools/verify_isolation.py.
    """
    return Path(path_str).read_text(encoding="utf-8")


def load_app_styles():
    """Inject the stylesheet. Called on EVERY rerun, so it must not touch disk.

    It used to `read_text()` 48 KB from disk on every rerun -- every button click,
    every keystroke in a number input -- before a single line of page code ran.
    The browser still receives the <style> block each run; only the disk read and
    the decode are cached.
    """
    css = _read_styles(str(STYLES_PATH), _styles_cache_key(STYLES_PATH))
    st.markdown(f"<style>\n{css}\n</style>", unsafe_allow_html=True)
