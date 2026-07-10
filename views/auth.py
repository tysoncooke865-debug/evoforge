"""The sign-in / sign-up gate.

Rendered by app.py instead of the router when nobody is signed in. Nothing else
in the app renders on that pass — see the `st.stop()` in app.py.
"""

import streamlit as st

from auth.session import MIN_PASSWORD_LENGTH, sign_in, sign_up


def _brand():
    st.markdown(
        """
        <div class="ef-auth-hero">
            <div class="ef-auth-mark">EVOFORGE</div>
            <div class="ef-auth-tagline">Your lifts. Your character. One save file.</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _sign_in_tab():
    with st.form("ef_sign_in", clear_on_submit=False):
        email = st.text_input("Email", key="signin_email", autocomplete="username")
        password = st.text_input(
            "Password", type="password", key="signin_password", autocomplete="current-password"
        )
        submitted = st.form_submit_button("Enter the Forge", type="primary", width="stretch")

    if not submitted:
        return

    if not email.strip() or not password:
        st.error("Enter your email and password.")
        return

    ok, error = sign_in(email, password)
    if ok:
        st.session_state.just_saved_message = "WELCOME BACK"
        st.rerun()
    else:
        st.error(error)


def _sign_up_tab():
    with st.form("ef_sign_up", clear_on_submit=False):
        email = st.text_input("Email", key="signup_email", autocomplete="username")
        password = st.text_input(
            "Password",
            type="password",
            key="signup_password",
            autocomplete="new-password",
            help=f"At least {MIN_PASSWORD_LENGTH} characters.",
        )
        confirm = st.text_input(
            "Confirm password", type="password", key="signup_confirm", autocomplete="new-password"
        )
        submitted = st.form_submit_button("Forge my character", type="primary", width="stretch")

    if not submitted:
        return

    if not email.strip() or not password:
        st.error("Enter an email and a password.")
        return
    if password != confirm:
        st.error("The two passwords do not match.")
        return

    ok, error, needs_confirmation = sign_up(email, password)
    if not ok:
        st.error(error)
        return

    if needs_confirmation:
        st.success("Account created. Check your inbox for the confirmation link, then sign in.")
        return

    st.session_state.just_saved_message = "CHARACTER CREATED"
    st.rerun()


def render():
    _brand()

    left, mid, right = st.columns([1, 2, 1])
    with mid:
        signin, signup = st.tabs(["Sign in", "Create account"])
        with signin:
            _sign_in_tab()
        with signup:
            _sign_up_tab()

        st.markdown(
            '<div class="ef-auth-note">EvoForge stores body measurements and physique '
            "analysis. Your data is visible only to you.</div>",
            unsafe_allow_html=True,
        )
