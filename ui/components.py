import pandas as pd
import streamlit as st

from data.supabase_client import supabase_enabled
from domain.workouts import load_log, workout_summary, normalise_workout_log
from domain.avatar_stats import (
    calculate_avatar_stats, avatar_asset_for_stats, evolution_name, branch_display_name,
    rarity_badge_html, next_evolution_info,
)
from domain.xp_leveling import current_level_xp
from ui.avatar_images import avatar_img_tag, get_avatar_image_object, make_locked_silhouette_image
from ui.nav import route_button


def render_forge_signature():
    """Status strip. The brand wordmark lives in the nav, not here.

    Live sync state is rendered by render_forge_micro_status(); this strip
    carries the tagline and the always-on engine indicator.
    """
    st.markdown(
        """
        <div class="forge-signature">
            <div class="forge-sigil">⚡</div>
            <div class="forge-signature-copy">
                <div class="forge-subtitle">Body-to-build progression engine</div>
            </div>
            <div class="forge-status">ONLINE</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_today_quest_card(stats=None):
    if stats is None:
        stats = calculate_avatar_stats()

    branch, stage, path = avatar_asset_for_stats(stats)
    level = int(stats.get("level", 1))
    weak = str(stats.get("weak_point_focus", "Balanced"))
    form = evolution_name(branch, level)

    # Simple default quest logic based on weak point.
    focus = weak.lower()
    if "lat" in focus or "back" in focus:
        quest = "V-Taper Quest"
        target = "Prioritise lat pulldown, rows and controlled stretch reps."
        reward = "+ Back Load • + Aesthetic XP"
    elif "chest" in focus or "upper" in focus:
        quest = "Upper Chest Quest"
        target = "Prioritise incline pressing and deep controlled chest work."
        reward = "+ Chest Load • + Form XP"
    elif "conditioning" in focus or "engine" in focus or "cardio" in focus:
        quest = "Engine Quest"
        target = "Complete your cardio block and log the session."
        reward = "+ Engine XP • + Hybrid Score"
    else:
        quest = "Daily Forge Quest"
        target = "Complete today’s mission and log every working set."
        reward = "+ XP • + Class Progress"

    st.markdown(
        f"""
        <div class="today-quest-card">
            <div class="today-quest-head">
                <div>
                    <div class="avatar-kicker">TODAY'S QUEST</div>
                    <div class="today-quest-title">{quest}</div>
                    <div class="today-quest-sub">{form} • Level {level}</div>
                </div>
                <div class="today-quest-reward">{reward}</div>
            </div>
            <div class="today-quest-target">{target}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_forge_micro_status():
    connected = supabase_enabled()

    status = "CLOUD SYNC" if connected else "LOCAL BACKUP"
    icon = "🟢" if connected else "🟡"

    st.markdown(
        f"""
        <div class="forge-micro-status">
            <span>{icon} {status}</span>
            <span>XP ENGINE ACTIVE</span>
            <span>AVATAR CORE READY</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def get_fast_snapshot():
    if "_fast_snapshot" in st.session_state:
        return st.session_state["_fast_snapshot"]

    try:
        df = load_log()
    except Exception:
        df = pd.DataFrame()

    try:
        summary = workout_summary(df)
    except Exception:
        summary = {}

    snap = {"df": df, "summary": summary}
    st.session_state["_fast_snapshot"] = snap
    return snap


def clear_fast_snapshot():
    from data.csv_store import cached_read_csv_file
    from ui.avatar_images import cached_img_to_base64

    st.session_state.pop("_fast_snapshot", None)
    try:
        cached_read_csv_file.clear()
    except Exception:
        pass
    try:
        cached_img_to_base64.clear()
    except Exception:
        pass


def ui_toast_area():
    if st.session_state.get("just_saved_message"):
        st.markdown(
            f"""
            <div class="floating-toast save-toast">
                ✅ {st.session_state.get("just_saved_message")}
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.session_state.just_saved_message = ""

    if st.session_state.get("pr_message"):
        st.markdown(
            f"""
            <div class="floating-toast pr-toast">
                🏆 PR DETECTED — {st.session_state.get("pr_message")}
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.session_state.pr_message = ""

    if st.session_state.get("achievement_message"):
        st.markdown(
            f"""
            <div class="floating-toast achievement-toast">
                🎖️ {st.session_state.get("achievement_message")}
            </div>
            """,
            unsafe_allow_html=True,
        )
        st.session_state.achievement_message = ""


def page_hero(title, subtitle="", badge=""):
    badge_html = f'<div class="hero-badge">{badge}</div>' if badge else ""
    st.markdown(
        f"""
        <div class="hero-panel">
            <div>
                <div class="hero-title">{title}</div>
                <div class="hero-subtitle">{subtitle}</div>
            </div>
            {badge_html}
        </div>
        """,
        unsafe_allow_html=True,
    )


def section_card(title, body="", icon=""):
    st.markdown(
        f"""
        <div class="section-card">
            <div class="section-card-title">{icon} {title}</div>
            <div class="section-card-body">{body}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def compact_metric(label, value, helper=""):
    st.markdown(
        f"""
        <div class="compact-metric">
            <div class="compact-label">{label}</div>
            <div class="compact-value">{value}</div>
            <div class="compact-helper">{helper}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_base_console_panel(stats=None):
    """
    Render the Base console without raw HTML leakage.
    The previous version split one <div> across multiple Streamlit elements and
    used heavily indented HTML, which Streamlit rendered as a code block on mobile.
    """
    if stats is None:
        try:
            stats = calculate_avatar_stats()
        except Exception:
            stats = {}

    level = int(stats.get("level", 1))
    branch = stats.get("avatar_branch", "aesthetic")
    branch_name = branch_display_name(branch)
    stage_name = evolution_name(branch, level)

    try:
        summary = get_fast_snapshot().get("summary", {})
        _, xp_now, xp_need = current_level_xp(summary)
        xp_pct = max(0, min((xp_now / xp_need) * 100, 100))
    except Exception:
        xp_now, xp_need, xp_pct = 0, 500, 0

    try:
        _, _, avatar_path = avatar_asset_for_stats(stats)
        img_tag = avatar_img_tag(avatar_path, css_class="ef-console-avatar-img")
    except Exception:
        img_tag = ""

    rarity = rarity_badge_html(level)

    st.markdown('<div class="ef-console-heading">FORGE CONSOLE</div>', unsafe_allow_html=True)

    left, right = st.columns([0.92, 1.5], gap="large")

    with left:
        avatar_body = img_tag or '<div class="ef-avatar-placeholder">⚡</div>'
        st.markdown(
            f'<div class="ef-console-image-card">'
            f'{avatar_body}'
            f'<div class="ef-rarity-pill">{rarity}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    with right:
        st.markdown(
            '<div class="ef-stat-grid">'
            f'<div class="ef-stat-tile"><span>LEVEL</span><b>{level}</b></div>'
            f'<div class="ef-stat-tile"><span>BRANCH</span><b>{branch_name}</b></div>'
            f'<div class="ef-stat-tile"><span>STAGE</span><b>{stage_name}</b></div>'
            '</div>',
            unsafe_allow_html=True,
        )

        st.markdown(
            '<div class="ef-section-kicker">XP PROGRESS</div>'
            f'<div class="ef-xp-track"><div style="width:{xp_pct:.1f}%"></div></div>'
            f'<div class="ef-xp-caption">{xp_now} XP • Level {level} → {level + 1}</div>',
            unsafe_allow_html=True,
        )

        st.markdown(
            '<div class="ef-attribute-list">'
            f'<div><span>💪 Strength</span><b>{int(stats.get("strength_score", 0))}</b></div>'
            f'<div><span>📐 Size</span><b>{int(stats.get("size_score", 0))}</b></div>'
            f'<div><span>🔥 Leanness</span><b>{int(stats.get("leanness_score", 0))}</b></div>'
            f'<div><span>💗 Conditioning</span><b>{int(stats.get("conditioning_score", 0))}</b></div>'
            f'<div><span>✨ Aesthetic</span><b>{int(stats.get("aesthetic_score", 0))}</b></div>'
            '</div>',
            unsafe_allow_html=True,
        )


def render_evolution_showcase(stats=None):
    if stats is None:
        try:
            stats = calculate_avatar_stats()
        except Exception:
            stats = {}

    level = int(stats.get("level", 1))
    branch = stats.get("avatar_branch", "aesthetic")

    try:
        _, _, current_path = avatar_asset_for_stats(stats)
        current_img = get_avatar_image_object(current_path)
    except Exception:
        current_img = None

    try:
        target_name, target_level, _ = next_evolution_info(branch, stats)
        preview_stats = dict(stats)
        preview_stats["level"] = int(target_level)
        _, _, next_path = avatar_asset_for_stats(preview_stats)
        next_img = get_avatar_image_object(next_path)
        if next_img is not None and level < int(target_level):
            next_img = make_locked_silhouette_image(next_img)
    except Exception:
        target_name, target_level, next_img = "Next Evolution", 25, None

    current_tag = avatar_img_tag(current_img, css_class="ef-evo-img") if current_img is not None else ""
    next_tag = avatar_img_tag(next_img, css_class="ef-evo-img") if next_img is not None else ""

    col1, col2 = st.columns(2, gap="large")
    with col1:
        st.markdown(
            f'<div class="ef-evo-panel">'
            f'<div class="ef-evo-title">CURRENT FORM</div>{current_tag}'
            f'</div>',
            unsafe_allow_html=True,
        )
    with col2:
        locked_text = "LOCKED" if level < int(target_level) else "UNLOCKED"
        st.markdown(
            f'<div class="ef-evo-panel">'
            f'<div class="ef-evo-title">NEXT FORM — {target_name.upper()} ({locked_text})</div>{next_tag}'
            f'</div>',
            unsafe_allow_html=True,
        )


def render_qol_action_card(title, description, button_text, target_page, key, icon="⚡"):
    st.markdown(
        f"""
        <div class="qol-action-card">
            <div class="qol-action-icon">{icon}</div>
            <div class="qol-action-copy">
                <div class="qol-action-title">{title}</div>
                <div class="qol-action-text">{description}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    route_button(button_text, target_page, key=key)


def render_target_bar(title, current, target, unit, lower_is_better=False, action_label=None, action_page=None, action_key=None):
    if current is None or target is None:
        st.info(f"{title}: Set a target to begin.")
        if action_label and action_page and action_key:
            route_button(action_label, action_page, key=action_key)
        return

    try:
        current = float(current)
        target = float(target)
    except Exception:
        st.info(f"{title}: Waiting for valid target/data.")
        if action_label and action_page and action_key:
            route_button(action_label, action_page, key=action_key)
        return

    if target <= 0:
        st.info(f"{title}: Target must be above 0.")
        if action_label and action_page and action_key:
            route_button(action_label, action_page, key=action_key)
        return

    if lower_is_better:
        progress = 100 if current <= target else ((target / current) * 100 if current > 0 else 0)
    else:
        progress = (current / target) * 100 if target else 0

    progress = max(0, min(progress, 100))

    st.markdown(
        f"""
        <div class="mission-card target-action-card">
            <div class="mission-title">{title}</div>
            <div class="progress-track">
                <div class="progress-fill" style="--progress:{progress:.1f}%;"></div>
            </div>
            <div class="progress-label">{current:.1f}{unit} / {target:.1f}{unit} ({progress:.0f}%)</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if action_label and action_page and action_key:
        route_button(action_label, action_page, key=action_key)


def completed_sets_for_day_unique(log_df, workout_date, workout):
    """
    Count actual completed sets once only.

    Critical fix:
    workout_log rows are normalised to the column 'set'. The previous function
    looked for 'set_number', so it only found 'exercise' and counted an entire
    completed exercise as 1 set. This counts exercise + set number.
    """
    from domain.workouts import completed_sets_for_day

    try:
        if log_df is None or log_df.empty:
            return 0

        dfc = normalise_workout_log(log_df.copy())

        dfc["date"] = dfc["date"].astype(str)
        dfc["workout"] = dfc["workout"].astype(str)
        dfc["exercise"] = dfc["exercise"].astype(str)
        dfc["set"] = pd.to_numeric(dfc["set"], errors="coerce").fillna(0).astype(int)
        dfc["weight"] = pd.to_numeric(dfc["weight"], errors="coerce").fillna(0)
        dfc["reps"] = pd.to_numeric(dfc["reps"], errors="coerce").fillna(0)

        dfc = dfc[
            (dfc["date"] == str(workout_date)) &
            (dfc["workout"] == str(workout)) &
            (dfc["set"] > 0) &
            (dfc["weight"] > 0) &
            (dfc["reps"] > 0)
        ].copy()

        if dfc.empty:
            return 0

        # Correct set-level dedupe: set 1 + set 2 of the same exercise count as 2.
        dfc = dfc.drop_duplicates(
            subset=["date", "workout", "exercise", "set"],
            keep="last"
        )

        return int(len(dfc))
    except Exception:
        try:
            return int(completed_sets_for_day(log_df, workout_date, workout))
        except Exception:
            return 0
