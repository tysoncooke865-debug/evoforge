import pandas as pd
import streamlit as st

from data.supabase_client import supabase_enabled
from domain.workouts import load_log, workout_summary, normalise_workout_log
from domain.avatar_stats import (
    calculate_avatar_stats, avatar_asset_for_stats, evolution_name, branch_display_name,
    rarity_badge_html, next_evolution_info, avatar_rarity,
)
from domain.xp import progress_percent, xp_for_level
from domain.xp_leveling import current_level_xp
from ui.avatar_images import avatar_stage_html, get_avatar_image_object, make_locked_silhouette_image
from ui.nav import route_button


def _rarity_slug(level):
    try:
        return avatar_rarity(int(level))[0].lower()
    except Exception:
        return "common"


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
    dot = "is-online" if connected else "is-local"

    st.markdown(
        f"""
        <div class="forge-micro-status">
            <span class="fms-item"><i class="fms-dot {dot}"></i>{status}</span>
            <span class="fms-item">XP ENGINE ACTIVE</span>
            <span class="fms-item">AVATAR CORE READY</span>
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


def ui_toast_area():
    """Render and clear the one-shot save / PR / achievement toasts."""
    if st.session_state.get("just_saved_message"):
        st.markdown(
            f'<div class="floating-toast save-toast">✅ {st.session_state.get("just_saved_message")}</div>',
            unsafe_allow_html=True,
        )
        st.session_state.just_saved_message = ""

    if st.session_state.get("pr_message"):
        st.markdown(
            f'<div class="floating-toast pr-toast">🏆 PR DETECTED — {st.session_state.get("pr_message")}</div>',
            unsafe_allow_html=True,
        )
        st.session_state.pr_message = ""

    if st.session_state.get("achievement_message"):
        st.markdown(
            f'<div class="floating-toast achievement-toast">🎖️ {st.session_state.get("achievement_message")}</div>',
            unsafe_allow_html=True,
        )
        st.session_state.achievement_message = ""


def page_hero(title, subtitle="", badge=""):
    badge_html = f'<div class="hero-badge">{badge}</div>' if badge else ""
    st.markdown(
        f"""
        <div class="hero-panel">
            <div class="hero-copy">
                <div class="hero-title">{title}</div>
                <div class="hero-subtitle">{subtitle}</div>
            </div>
            {badge_html}
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
    """The Forge Console: avatar stage + level/branch/stage tiles + attributes.

    Every sub-block is emitted as one balanced markdown call. Splitting a <div>
    across separate st.markdown calls does not nest -- Streamlit sanitizes each
    call independently and auto-closes the tag.
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
    rarity = _rarity_slug(level)

    try:
        summary = get_fast_snapshot().get("summary", {})
        _, xp_now, xp_need = current_level_xp(summary)
        xp_pct = progress_percent(xp_now, xp_need)
    except Exception:
        xp_now, xp_need, xp_pct = 0, xp_for_level(1), 0.0

    try:
        _, _, avatar_path = avatar_asset_for_stats(stats)
        stage_html = avatar_stage_html(avatar_path, rarity=rarity, size="lg", alt="Current form")
    except Exception:
        stage_html = ""

    rarity_badge = rarity_badge_html(level)

    st.markdown('<div class="ef-console-heading">FORGE CONSOLE</div>', unsafe_allow_html=True)

    left, right = st.columns([0.92, 1.5], gap="large")

    with left:
        avatar_body = stage_html or '<div class="ef-avatar-placeholder">⚡</div>'
        st.markdown(
            f'<div class="ef-console-image-card rarity-{rarity}">'
            f"{avatar_body}"
            f'<div class="ef-rarity-pill">{rarity_badge}</div>'
            f"</div>",
            unsafe_allow_html=True,
        )

    with right:
        st.markdown(
            f'<div class="ef-stat-grid">'
            f'<div class="ef-stat-tile"><span>LEVEL</span><b>{level}</b></div>'
            f'<div class="ef-stat-tile"><span>BRANCH</span><b>{branch_name}</b></div>'
            f'<div class="ef-stat-tile"><span>STAGE</span><b>{stage_name}</b></div>'
            f"</div>"
            f'<div class="ef-section-kicker">XP PROGRESS</div>'
            f'<div class="ef-xp-track"><div class="ef-xp-fill" style="--xp:{xp_pct:.1f}%"></div></div>'
            f'<div class="ef-xp-caption">{xp_now} / {xp_need} XP • Level {level} → {level + 1}</div>'
            f'<div class="ef-attribute-list">'
            f'<div><span>💪 Strength</span><b>{int(stats.get("strength_score", 0))}</b></div>'
            f'<div><span>📐 Size</span><b>{int(stats.get("size_score", 0))}</b></div>'
            f'<div><span>🔥 Leanness</span><b>{int(stats.get("leanness_score", 0))}</b></div>'
            f'<div><span>💗 Conditioning</span><b>{int(stats.get("conditioning_score", 0))}</b></div>'
            f'<div><span>✨ Aesthetic</span><b>{int(stats.get("aesthetic_score", 0))}</b></div>'
            f"</div>",
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
        current_html = avatar_stage_html(
            current_path, rarity=_rarity_slug(level), size="md", alt="Current form"
        )
    except Exception:
        current_html = ""

    try:
        target_name, target_level, _ = next_evolution_info(branch, stats)
        preview_stats = dict(stats)
        preview_stats["level"] = int(target_level)
        _, _, next_path = avatar_asset_for_stats(preview_stats)
        next_img = get_avatar_image_object(next_path)
        locked = level < int(target_level)
        if next_img is not None and locked:
            next_img = make_locked_silhouette_image(next_img)
        next_html = (
            avatar_stage_html(
                next_img, rarity=_rarity_slug(target_level), size="md",
                locked=locked, alt=f"Next form: {target_name}",
            )
            if next_img is not None else ""
        )
    except Exception:
        target_name, target_level, next_html, locked = "Next Evolution", 25, "", True

    col1, col2 = st.columns(2, gap="large")
    with col1:
        st.markdown(
            f'<div class="ef-evo-panel">'
            f'<div class="ef-evo-title">CURRENT FORM</div>{current_html}'
            f"</div>",
            unsafe_allow_html=True,
        )
    with col2:
        locked_text = "LOCKED" if locked else "UNLOCKED"
        st.markdown(
            f'<div class="ef-evo-panel {"is-locked" if locked else "is-unlocked"}">'
            f'<div class="ef-evo-title">NEXT FORM — {target_name.upper()} ({locked_text})</div>'
            f"{next_html}"
            f"</div>",
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


def render_target_bar(title, current, target, unit, lower_is_better=False,
                      action_label=None, action_page=None, action_key=None,
                      helper=None, decimals=1):
    """THE progress-bar primitive. Every "x of y" bar in the app renders through here.

    Hand-rolling `.mission-card` + `.progress-track` + `.progress-fill` was the most
    duplicated markup in the codebase -- five copies across `home`, `bodyfat` and
    `today`, each free to drift in rounding, clamping and class names. Use this.

    `lower_is_better` inverts the ratio, for targets you shrink toward (body fat,
    waist). Progress is clamped to 0-100 and never divides by zero.

    `helper` adds a second line under the bar -- the "Base level 42" that the XP
    card needs. `decimals` controls the numbers in the label: XP is a whole number,
    kilograms are not.

    Falls back to `st.info` rather than a broken bar when the target is missing or
    non-numeric, because "no target set" and "target of zero" are different states
    and neither should render as 0%.
    """
    def _action():
        if action_label and action_page and action_key:
            route_button(action_label, action_page, key=action_key)

    if current is None or target is None:
        st.info(f"{title}: Set a target to begin.")
        _action()
        return

    try:
        current = float(current)
        target = float(target)
    except Exception:
        st.info(f"{title}: Waiting for valid target/data.")
        _action()
        return

    if target <= 0:
        st.info(f"{title}: Target must be above 0.")
        _action()
        return

    if lower_is_better:
        progress = 100 if current <= target else ((target / current) * 100 if current > 0 else 0)
    else:
        progress = (current / target) * 100 if target else 0

    progress = max(0, min(progress, 100))
    hit = "is-complete" if progress >= 100 else ""
    helper_html = f'<div class="progress-helper">{helper}</div>' if helper else ""

    # One balanced f-string. A <div> split across two st.markdown calls does not
    # nest -- Streamlit sanitizes each call and auto-closes the tag.
    st.markdown(
        f"""
        <div class="mission-card target-action-card {hit}">
            <div class="mission-title">{title}</div>
            <div class="progress-track">
                <div class="progress-fill" style="--progress:{progress:.1f}%;"></div>
            </div>
            <div class="progress-label">{current:.{decimals}f}{unit} / {target:.{decimals}f}{unit} ({progress:.0f}%)</div>
            {helper_html}
        </div>
        """,
        unsafe_allow_html=True,
    )

    _action()


def completed_sets_for_day_unique(log_df, workout_date, workout):
    """
    Count actual completed sets once only.

    workout_log rows normalise to the column 'set'. An earlier version looked
    for 'set_number', so it only matched 'exercise' and counted a whole
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

        dfc = dfc.drop_duplicates(subset=["date", "workout", "exercise", "set"], keep="last")
        return int(len(dfc))
    except Exception:
        try:
            return int(completed_sets_for_day(log_df, workout_date, workout))
        except Exception:
            return 0
