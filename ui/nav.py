import streamlit as st

from domain.xp import progress_percent, xp_for_level
from domain.xp_leveling import current_level_xp
from domain.avatar_stats import (
    branch_display_name, avatar_asset_for_stats, avatar_rarity,
)
from ui.avatar_images import img_to_base64
from ui.render_memo import avatar_stats

PRIMARY_PAGES = ["Home", "Today", "Avatar", "Progress", "Physique", "Cardio", "Goals", "Data Manager"]
MORE_PAGES = ["Profile", "Measurements", "Achievements", "Body Fat", "Bodyweight", "Routine", "Delete Data"]
ALL_PAGES = PRIMARY_PAGES + MORE_PAGES

PAGE_LABELS = {
    "Home": "🏠 Base",
    "Today": "⚔️ Missions",
    "Avatar": "🧬 Evolution",
    "Progress": "📊 Analytics",
    "Physique": "🤖 Oracle",
    "Cardio": "❤️ Engine",
    "Goals": "🎯 Quests",
    "Data Manager": "📂 Data",
    "Profile": "🪪 Profile",
    "Measurements": "📏 Measurements",
    "Achievements": "🏆 Achievements",
    "Body Fat": "🔥 Body Fat",
    "Bodyweight": "⚖️ Bodyweight",
    "Routine": "📋 Routine",
    "Delete Data": "🗑️ Delete Data",
}

LABEL_TO_PAGE = {v: k for k, v in PAGE_LABELS.items()}

# (page_key, icon, label, group)
NAV_ITEMS = [
    ("Home", "🏠", "Base", "core"),
    ("Today", "⚔️", "Missions", "core"),
    ("Avatar", "🧬", "Evolution", "core"),
    ("Progress", "📊", "Analytics", "core"),
    ("Physique", "🤖", "Oracle", "core"),
    ("Cardio", "❤️", "Engine", "core"),
    ("Goals", "🎯", "Quests", "core"),
    ("Profile", "🪪", "Profile", "system"),
    ("Measurements", "📏", "Measurements", "system"),
    ("Body Fat", "🔥", "Body Fat", "system"),
    ("Bodyweight", "⚖️", "Bodyweight", "system"),
    ("Routine", "📋", "Routine", "system"),
    ("Achievements", "🏆", "Achievements", "system"),
    ("Data Manager", "📂", "Data", "system"),
    ("Delete Data", "🗑️", "Delete Data", "system"),
]


def resolve_page_from_state():
    pending_page = st.session_state.pop("pending_page", None)
    if pending_page in ALL_PAGES:
        st.session_state.active_page = pending_page
        return pending_page

    # Only read the query param once, so it never blocks manual nav changes.
    if not st.session_state.get("_nav_initialised", False):
        try:
            nav_query_page = st.query_params.get("nav", None)
            if isinstance(nav_query_page, list):
                nav_query_page = nav_query_page[0] if nav_query_page else None
            if nav_query_page in ALL_PAGES:
                st.session_state.active_page = nav_query_page
        except Exception:
            pass
        st.session_state["_nav_initialised"] = True

    return st.session_state.active_page


def route_to(page_name):
    """Single routing entry point for sidebar, action cards and Back to Base."""
    if page_name not in ALL_PAGES:
        page_name = "Home"
    st.session_state.pending_page = page_name
    st.session_state.active_page = page_name
    st.session_state["_nav_initialised"] = True
    try:
        st.query_params["nav"] = page_name
    except Exception:
        pass
    st.rerun()


def route_button(label, page_name, key, help_text=None, type="secondary"):
    return st.button(
        label,
        key=key,
        help=help_text,
        type=type,
        width="stretch",
        on_click=route_to,
        args=(page_name,),
    )


def get_sidebar_avatar_payload():
    try:
        stats = avatar_stats()
    except Exception:
        stats = {"level": 1, "avatar_branch": "aesthetic"}

    level = int(stats.get("level", 1))
    branch = stats.get("avatar_branch", "aesthetic")
    branch_name = branch_display_name(branch)

    # get_fast_snapshot lives in ui.components and caches the summary in
    # session_state, so this must not fall back to a fresh load_log() fetch.
    try:
        from ui.components import get_fast_snapshot
        summary = get_fast_snapshot().get("summary", {})
    except Exception:
        summary = {}

    try:
        _, xp_now, xp_need = current_level_xp(summary)
        xp_pct = progress_percent(xp_now, xp_need)
    except Exception:
        xp_now, xp_need, xp_pct = 0, xp_for_level(1), 0.0

    avatar_src = ""
    try:
        _, _, avatar_path = avatar_asset_for_stats(stats)
        avatar_b64 = img_to_base64(avatar_path)
        if avatar_b64:
            avatar_src = f"data:image/png;base64,{avatar_b64}"
    except Exception:
        pass

    return stats, level, branch_name, xp_now, xp_need, xp_pct, avatar_src


def render_sidebar_navigation(active_page):
    """The single source of navigation.

    On desktop the sidebar is always visible. On mobile Streamlit collapses it
    behind its own toggle, so this remains reachable -- which is why there is
    no second nav widget in the main column.
    """
    stats, level, branch_name, xp_now, xp_need, xp_pct, avatar_src = get_sidebar_avatar_payload()
    rarity_name, rarity_icon, _ = avatar_rarity(level)
    rarity_class = f"rarity-{rarity_name.lower()}"

    # branch_display_name() already carries its own emoji ("💎 Aesthetic"), so
    # printing the rarity icon beside it renders a doubled glyph. Strip it.
    branch_plain = branch_name.split(" ", 1)[-1] if " " in branch_name else branch_name

    avatar_inner = (
        f'<img src="{avatar_src}" class="ef-side-avatar-img" alt="Avatar" />'
        if avatar_src else '<div class="ef-side-avatar-fallback">⚡</div>'
    )

    st.sidebar.markdown(
        f"""
        <div class="ef-sidebar-brand">
            <div class="ef-logo">EVO<span>FORGE</span></div>
            <div class="ef-tag">BODY-TO-BUILD ENGINE</div>
        </div>

        <div class="ef-side-avatar-card {rarity_class}">
            <div class="ef-side-avatar-img-wrap">
                <div class="ef-side-avatar-aura"></div>
                {avatar_inner}
            </div>
            <div class="ef-side-avatar-meta">
                <div class="ef-side-lv">LV {level}</div>
                <div class="ef-side-rank">{rarity_icon} {rarity_name} · {branch_plain}</div>
            </div>
        </div>

        <div class="ef-side-xp"><div class="ef-side-xp-fill" style="--xp:{xp_pct:.1f}%"></div></div>
        <div class="ef-side-xp-caption">{xp_now} / {xp_need} XP</div>
        """,
        unsafe_allow_html=True,
    )

    last_group = None
    for i, (page_key, icon, label, group) in enumerate(NAV_ITEMS):
        if group != last_group:
            title = "NAVIGATION" if group == "core" else "SYSTEM"
            st.sidebar.markdown(f'<div class="ef-side-nav-title">{title}</div>', unsafe_allow_html=True)
            last_group = group

        active = page_key == active_page
        if st.sidebar.button(
            f"{icon}  {label}",
            key=f"evoforge_sidebar_{i}_{page_key}",
            width="stretch",
            type="primary" if active else "secondary",
        ):
            route_to(page_key)


def render_sidebar_account():
    """Signed-in identity and sign-out, at the foot of the sidebar."""
    from auth.session import current_user_email, sign_out

    email = current_user_email()
    if not email:
        return

    st.sidebar.markdown('<div class="ef-side-nav-title">ACCOUNT</div>', unsafe_allow_html=True)
    st.sidebar.markdown(
        f'<div class="ef-side-account" title="{email}">{email}</div>',
        unsafe_allow_html=True,
    )
    if st.sidebar.button("Sign out", key="evoforge_sign_out", width="stretch"):
        sign_out()
        st.rerun()


def render_mobile_navigation(active_page):
    """Slim mobile-only brand bar. Deliberately carries no nav widget.

    Navigation lives solely in the sidebar. A second page-picker here rendered
    two competing navigation systems on screen at once.
    """
    current_label = PAGE_LABELS.get(active_page, PAGE_LABELS["Home"])
    st.markdown(
        f"""
        <div class="ef-mobile-header">
            <div class="ef-mobile-brand">
                <div class="ef-mobile-title">EVOFORGE</div>
                <div class="ef-mobile-sub">BODY-TO-BUILD ENGINE</div>
            </div>
            <div class="ef-mobile-active">{current_label}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
