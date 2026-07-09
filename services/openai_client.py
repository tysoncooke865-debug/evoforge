import base64
import os

import streamlit as st


def encode_image_for_openai(uploaded_file):
    data = uploaded_file.getvalue()
    mime = uploaded_file.type or "image/jpeg"
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


def encode_uploaded_image(uploaded_file):
    return encode_image_for_openai(uploaded_file)


def _get_openai_client():
    try:
        from openai import OpenAI
    except Exception as e:
        return None, f"OpenAI package not installed. Add 'openai' to requirements.txt. Error: {e}"

    api_key = None
    try:
        api_key = st.secrets.get("OPENAI_API_KEY", None)
    except Exception:
        api_key = None

    api_key = api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None, "Missing OPENAI_API_KEY. Add it to Streamlit Cloud secrets."

    return OpenAI(api_key=api_key), None
