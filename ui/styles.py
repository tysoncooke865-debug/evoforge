from pathlib import Path

import streamlit as st

STYLES_PATH = Path(__file__).resolve().parent.parent / "assets" / "styles.css"


def load_app_styles():
    css = STYLES_PATH.read_text(encoding="utf-8")
    st.markdown(f"<style>\n{css}\n</style>", unsafe_allow_html=True)
