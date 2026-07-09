import streamlit as st

from domain.workouts import load_log, workout_summary
from domain.xp_leveling import current_level_xp
from domain.avatar_stats import (
    calculate_avatar_stats, branch_display_name, avatar_asset_for_stats,
)
from ui.avatar_images import img_to_base64

VALID_PAGES = [
    "Home", "Today", "Avatar", "Progress", "Physique",
    "Cardio", "Goals", "Data Manager", "Profile", "Measurements",
    "Achievements", "Body Fat", "Bodyweight", "Delete Data", "Routine"
]

DISPLAY_TO_PAGE = {
    "🏠 Base": "Home",
    "⚔️ Missions": "Today",
    "🧬 Evolution": "Avatar",
    "📊 Analytics": "Progress",
    "🤖 Oracle": "Physique",
    "❤️ Engine": "Cardio",
    "🎯 Quests": "Goals",
    "⚙️ Data": "Data Manager",
    "⚙️ System": "Data Manager",
    "Profile": "Profile",
    "Measurements": "Measurements",
    "Bodyweight": "Bodyweight",
    "Routine": "Routine",
    "Achievements": "Achievements",
    "Delete Data": "Delete Data",
    "Body Fat": "Body Fat",
}


def nav_to(page_key):
    """Single source of truth for page navigation."""
    if page_key in DISPLAY_TO_PAGE:
        page_key = DISPLAY_TO_PAGE[page_key]

    if page_key not in VALID_PAGES:
        page_key = "Home"

    st.session_state.active_page = page_key
    st.session_state.pending_page = page_key
    try:
        st.query_params["nav"] = page_key
    except Exception:
        pass
    st.rerun()


def render_forge_console_nav(current_page):
    """
    Primary app navigation. This replaces the broken old Forge Console buttons.
    """
    st.markdown(
        """
        <div class="forge-console-nav-title">FORGE CONSOLE</div>
        """,
        unsafe_allow_html=True,
    )

    rows = [
        [("Home", "🏠", "Base"), ("Today", "⚔️", "Missions")],
        [("Avatar", "🧬", "Evolution"), ("Progress", "📊", "Analytics")],
        [("Physique", "🤖", "Oracle"), ("Cardio", "❤️", "Engine")],
        [("Goals", "🎯", "Quests"), ("Data Manager", "⚙️", "Data")],
    ]

    for row_i, row in enumerate(rows):
        cols = st.columns(len(row))
        for col, (page_key, icon, label) in zip(cols, row):
            active = current_page == page_key
            with col:
                button_type = "primary" if active else "secondary"
                if st.button(f"{icon} {label}", key=f"forge_nav_{row_i}_{page_key}", use_container_width=True, type=button_type):
                    nav_to(page_key)


def render_system_deck():
    """
    Secondary navigation. Replaces Other Features with reliable buttons.
    """
    st.markdown(
        """
        <div class="system-deck-wrap">
            <div class="system-deck-title">SYSTEM ACCESS</div>
            <div class="system-deck-sub">Calibration • Logs • Relics • Admin</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    rows = [
        [
            ("Profile", "ID", "Profile"),
            ("Measurements", "MEASURE", "Measurements"),
            ("Bodyweight", "SCALE", "Bodyweight"),
            ("Body Fat", "BF%", "Body Fat"),
        ],
        [
            ("Routine", "PLAN", "Routine"),
            ("Achievements", "RELICS", "Achievements"),
            ("Data Manager", "SYSTEM", "Data"),
            ("Delete Data", "DELETE", "Delete"),
        ],
    ]

    for row_index, row in enumerate(rows):
        cols = st.columns(len(row))
        for col, (page_key, code_label, text_label) in zip(cols, row):
            with col:
                if st.button(f"{code_label}\n{text_label}", key=f"system_access_{row_index}_{page_key}", use_container_width=True):
                    nav_to(page_key)


def render_bottom_nav(page):
    """
    Command Deck. Kept as a quick route strip, now uses the same nav_to() function.
    """
    items = [
        ("Home", "BASE", "Command"),
        ("Today", "MISSIONS", "Train"),
        ("Avatar", "EVOLVE", "Avatar"),
        ("Progress", "SCANNER", "Stats"),
        ("Physique", "ORACLE", "AI"),
    ]

    st.markdown('<div class="command-deck-wrap"><div class="command-deck-title">COMMAND DECK</div></div>', unsafe_allow_html=True)
    cols = st.columns(5)

    for col, (page_key, label, sub) in zip(cols, items):
        active = page == page_key
        with col:
            button_type = "primary" if active else "secondary"
            if st.button(f"{label}\n{sub}", key=f"command_deck_{page_key}", use_container_width=True, type=button_type):
                nav_to(page_key)


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


def resolve_page_from_state():
    pending_page = st.session_state.pop("pending_page", None)
    if pending_page in ALL_PAGES:
        st.session_state.active_page = pending_page
        st.session_state["single_working_navigation"] = PAGE_LABELS[pending_page]
        return pending_page

    # Only read query param once so it never blocks manual menu changes.
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
    """
    One routing function for sidebar, mobile menu, QoL buttons and Back to Base.
    """
    try:
        st.session_state.pending_page = page_name
        st.session_state.active_page = page_name
        st.session_state["_nav_initialised"] = True
        if page_name in PAGE_LABELS:
            st.session_state["single_working_navigation"] = PAGE_LABELS[page_name]
        try:
            st.query_params["nav"] = page_name
        except Exception:
            pass
    except Exception:
        st.session_state.pending_page = page_name
        st.session_state.active_page = page_name
    st.rerun()


def route_button(label, page_name, key, help_text=None, type="secondary"):
    return st.button(
        label,
        key=key,
        help=help_text,
        type=type,
        use_container_width=True,
        on_click=route_to,
        args=(page_name,),
    )


NAV_ITEMS = [
    ("Home", "🏠", "Base"),
    ("Today", "⚔️", "Missions"),
    ("Avatar", "🧬", "Evolution"),
    ("Progress", "📊", "Analytics"),
    ("Physique", "🤖", "Oracle"),
    ("Cardio", "❤️", "Engine"),
    ("Goals", "🎯", "Quests"),
    ("Data Manager", "📁", "Data"),
    ("Profile", "🪪", "Profile"),
    ("Measurements", "📏", "Measurements"),
    ("Body Fat", "🔥", "Body Fat"),
    ("Bodyweight", "⚖️", "Bodyweight"),
    ("Routine", "📋", "Routine"),
    ("Achievements", "🏆", "Achievements"),
    ("Delete Data", "🗑️", "Delete Data"),
]


def get_sidebar_avatar_payload():
    try:
        stats = calculate_avatar_stats()
    except Exception:
        stats = {"level": 1, "avatar_branch": "aesthetic"}

    level = int(stats.get("level", 1))
    branch = stats.get("avatar_branch", "aesthetic")
    branch_name = branch_display_name(branch)

    try:
        from app import get_fast_snapshot
        summary = get_fast_snapshot().get("summary", {})
    except Exception:
        summary = workout_summary(load_log())
    try:
        _, xp_now, xp_need = current_level_xp(summary)
        xp_pct = max(0, min((xp_now / xp_need) * 100, 100))
    except Exception:
        xp_now, xp_need, xp_pct = 0, 500, 0

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
    stats, level, branch_name, xp_now, xp_need, xp_pct, avatar_src = get_sidebar_avatar_payload()

    st.sidebar.markdown(
        f"""
        <div class="ef-sidebar-brand">
            <div class="ef-logo">EVO<span>FORGE</span></div>
            <div class="ef-tag">BODY-TO-BUILD ENGINE</div>
        </div>

        <div class="ef-side-avatar-card">
            <div class="ef-side-avatar-img-wrap">
                {'<img src="' + avatar_src + '" class="ef-side-avatar-img" />' if avatar_src else '<div class="ef-side-avatar-fallback">⚡</div>'}
            </div>
            <div>
                <div class="ef-side-lv">LV {level}</div>
                <div class="ef-side-rank">🧬 {branch_name}</div>
            </div>
        </div>

        <div class="ef-side-xp"><div class="ef-side-xp-fill" style="width:{xp_pct:.1f}%"></div></div>
        <div class="ef-side-xp-caption">{xp_now}/{xp_need} XP</div>
        <div class="ef-side-nav-title">NAVIGATION</div>
        """,
        unsafe_allow_html=True,
    )

    for i, (page_key, icon, label) in enumerate(NAV_ITEMS):
        active = page_key == active_page
        if st.sidebar.button(
            f"{icon} {label}",
            key=f"evoforge_sidebar_{i}_{page_key}",
            use_container_width=True,
            type="primary" if active else "secondary",
        ):
            route_to(page_key)


def render_mobile_navigation(active_page):
    """Mobile-only brand bar + page picker.

    Wrapped in a keyed container so CSS can hide *this* selectbox on desktop
    (via .st-key-ef-mobile-nav) without hiding every selectbox in the app.
    """
    current_label = PAGE_LABELS.get(active_page, PAGE_LABELS["Home"])
    if "single_working_navigation" not in st.session_state:
        st.session_state["single_working_navigation"] = current_label

    with st.container(key="ef-mobile-nav"):
        st.markdown(
            f"""
            <div class="ef-mobile-header">
                <div>
                    <div class="ef-mobile-title">EVOFORGE</div>
                    <div class="ef-mobile-sub">BODY-TO-BUILD ENGINE</div>
                </div>
                <div class="ef-mobile-active">{current_label}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        selected_label = st.selectbox(
            "Navigation",
            options=[PAGE_LABELS[p] for p in ALL_PAGES],
            key="single_working_navigation",
        )

    selected_page = LABEL_TO_PAGE.get(selected_label, active_page)
    if selected_page != active_page:
        route_to(selected_page)
