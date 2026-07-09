import streamlit as st

from domain.profile import rank_name
from domain.physique_ratings import safe_num
from domain.workouts import load_log, workout_summary
from domain.xp_leveling import current_level_xp, avatar_stage_rows
from domain.avatar_stats import (
    avatar_asset_for_stats, evolution_name, branch_display_name, rarity_badge_html,
    next_evolution_info,
)
from ui.avatar_images import get_avatar_image_object, make_locked_silhouette_image


def avatar_inline_stat(label, value, icon):
    value = int(max(0, min(safe_num(value, 0), 100)))
    return f"""
        <div class="avatar-inline-stat">
            <div class="avatar-inline-stat-top">
                <span>{icon} {label}</span>
                <b>{value}</b>
            </div>
            <div class="avatar-inline-track">
                <div class="avatar-inline-fill" style="--inline-progress:{value}%;"></div>
            </div>
        </div>
    """


def render_avatar_stat(label, value):
    value = int(max(0, min(safe_num(value, 0), 100)))
    st.markdown(
        f"""
        <div class="avatar-stat">
            <div class="avatar-stat-top">
                <span>{label}</span>
                <b>{value}</b>
            </div>
            <div class="avatar-track">
                <div class="avatar-fill" style="--avatar-progress:{value}%;"></div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_avatar_image_panel(stats, compact=False):
    branch, stage, path = avatar_asset_for_stats(stats)
    avatar_img = get_avatar_image_object(path)

    if avatar_img is None:
        st.error("Avatar image could not load. Check avatar_assets folder or embedded fallback images.")
        st.write(f"Expected path: `{path}`")
        return

    level = int(stats.get("level", 1))
    evo = evolution_name(branch, level)
    branch_name = branch_display_name(branch)
    rank = str(stats.get("rank", rank_name(level)))
    weak = str(stats.get("weak_point_focus", "Balanced"))

    st.markdown(
        """
        <div class="avatar-section-header">
            <div class="avatar-section-glow"></div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col_img, col_stats = st.columns([1.05, 0.95], vertical_alignment="center")

    with col_img:
        st.markdown('<div class="avatar-image-native-wrap">', unsafe_allow_html=True)
        st.image(avatar_img, use_container_width=True)
        st.markdown('</div>', unsafe_allow_html=True)

    with col_stats:
        st.markdown(
            f"""
            <div class="avatar-side-card-clean">
                <div class="avatar-kicker">CURRENT FORM</div>\n                {rarity_badge_html(level)}
                <div class="avatar-clean-title">{evo}</div>
                <div class="avatar-clean-sub">{branch_name} • Level {level}</div>
                <div class="avatar-clean-pills">
                    <span>{rank}</span>
                    <span>Focus: {weak}</span>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        render_avatar_stat("⚔️ Strength", stats.get("strength_score", 0))
        render_avatar_stat("🦍 Size", stats.get("size_score", 0))
        render_avatar_stat("💎 Leanness", stats.get("leanness_score", 0))
        render_avatar_stat("❤️ Conditioning", stats.get("conditioning_score", 0))
        render_avatar_stat("🔥 Aesthetic", stats.get("aesthetic_score", 0))


def render_next_evolution_card(stats):
    branch, stage, path = avatar_asset_for_stats(stats)
    target_name, target_level, reqs = next_evolution_info(branch, stats)
    level = int(stats.get("level", 1))

    # Preview uses the NEXT avatar image. If locked, we bake the image into
    # a black silhouette with cyan outline before rendering.
    preview_stats = dict(stats)
    preview_stats["level"] = int(target_level)
    preview_branch, preview_stage, preview_path = avatar_asset_for_stats(preview_stats)
    preview_img = get_avatar_image_object(preview_path)

    complete_count = sum(1 for _, _, _, complete in reqs if complete)
    total_count = max(1, len(reqs))
    ready_pct = int((complete_count / total_count) * 100)
    unlocked = level >= int(target_level)

    if preview_img is not None and not unlocked:
        preview_img = make_locked_silhouette_image(preview_img)

    st.markdown(
        f"""
        <div class="next-evo-preview-card clean-next-evo-card">
            <div class="next-evo-preview-head">
                <div>
                    <div class="avatar-kicker">NEXT EVOLUTION</div>
                    <div class="next-evo-title">{"✅" if unlocked else "🔒"} {target_name}</div>
                    <div class="next-evo-sub">{ready_pct}% unlock readiness</div>
                </div>
                <div class="next-evo-level">LVL {target_level}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col_prev, col_req = st.columns([0.52, 1.0], vertical_alignment="center")

    with col_prev:
        stage_class = "unlocked-stage" if unlocked else "locked-stage"
        badge = "✅ UNLOCKED" if unlocked else "🔒 LOCKED"
        mystery = target_name if unlocked else "NEXT FORM"

        st.markdown(
            f"""
            <div class="true-silhouette-panel {stage_class}">
                <div class="locked-badge">{badge}</div>
            """,
            unsafe_allow_html=True,
        )

        if preview_img is not None:
            st.image(preview_img, use_container_width=True)
        else:
            st.markdown('<div class="locked-silhouette">?</div>', unsafe_allow_html=True)

        st.markdown(
            f"""
                <div class="hidden-class">{mystery}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        reward_text = "+ Armour • + Aura • + Title"
        if branch == "mass":
            reward_text = "+ Heavy Armour • + Power Aura • + Titan Title"
        elif branch == "hybrid":
            reward_text = "+ Tactical Gear • + Speed Aura • + Apex Title"
        st.markdown(f'<div class="unlock-reward">Reward: {reward_text}</div>', unsafe_allow_html=True)

    with col_req:
        for label, current, target, complete in reqs:
            if label == "Body Fat":
                current_label = f"{current:.1f}%" if current else "No scan"
                target_label = f"{target:.1f}%"
                progress = 100 if complete else (max(0, min((target / current) * 100, 100)) if current else 0)
            else:
                current_label = f"{current:.1f}" if isinstance(current, float) else str(int(current))
                target_label = f"{target:.1f}" if isinstance(target, float) else str(int(target))
                progress = max(0, min((safe_num(current, 0) / safe_num(target, 1)) * 100, 100))

            icon = "✅" if complete else "⬜"
            st.markdown(
                f"""
                <div class="evo-req-row">
                    <div class="evo-req-label">{icon} {label}</div>
                    <div class="evo-req-value">{current_label} / {target_label}</div>
                </div>
                <div class="avatar-track evo-track">
                    <div class="avatar-fill" style="--avatar-progress:{progress}%;"></div>
                </div>
                """,
                unsafe_allow_html=True,
            )


def render_xp_level_card(summary=None):
    if summary is None:
        summary = workout_summary(load_log())

    level, xp_now, xp_need = current_level_xp(summary)
    pct = max(0, min((xp_now / xp_need) * 100, 100))
    to_next = max(0, xp_need - xp_now)

    st.markdown(
        f"""
        <div class="xp-level-card">
            <div class="xp-card-top">
                <div>
                    <div class="avatar-kicker">LEVEL PROGRESS</div>
                    <div class="xp-level-title">Level {level}</div>
                </div>
                <div class="xp-pill">{to_next} XP left</div>
            </div>
            <div class="avatar-track xp-track">
                <div class="avatar-fill xp-fill" style="--avatar-progress:{pct}%;"></div>
            </div>
            <div class="xp-caption">{xp_now} / {xp_need} XP to Level {level + 1}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_workout_xp_toast():
    # Trigger this after saves by setting:
    # st.session_state["last_xp_gain"] = 450
    # st.session_state["show_xp_toast"] = True
    if not st.session_state.get("show_xp_toast", False):
        return

    gain = int(st.session_state.get("last_xp_gain", 450))
    title = st.session_state.get("last_xp_title", "QUEST COMPLETE")
    subtitle = st.session_state.get("last_xp_subtitle", "Workout logged successfully")

    st.markdown(
        f"""
        <div class="xp-toast">
            <div class="xp-toast-burst">⚡</div>
            <div class="xp-toast-title">{title}</div>
            <div class="xp-toast-xp">+{gain} XP</div>
            <div class="xp-toast-sub">{subtitle}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.session_state["show_xp_toast"] = False


def render_evolution_path(stats):
    branch, stage, path = avatar_asset_for_stats(stats)
    level = int(stats.get("level", 1))
    rows = avatar_stage_rows(branch, level)

    st.markdown(
        f"""
        <div class="evolution-path-card">
            <div class="avatar-kicker">EVOLUTION PATH</div>
            <div class="evolution-path-title">{branch_display_name(branch)}</div>
            <div class="evolution-path-grid">
        """,
        unsafe_allow_html=True,
    )

    for r in rows:
        status = "✅" if r["unlocked"] else "🔒"
        current = "current-evo" if r["current"] else ""
        locked = "locked-evo" if not r["unlocked"] else ""
        st.markdown(
            f"""
            <div class="evolution-node {current} {locked}">
                <div class="evo-node-icon">{status}</div>
                <div class="evo-node-name">{r['name']}</div>
                <div class="evo-node-level">LVL {r['level']}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown("</div></div>", unsafe_allow_html=True)


def render_home_avatar_compact(stats):
    branch, stage, path = avatar_asset_for_stats(stats)
    avatar_img = get_avatar_image_object(path)
    if avatar_img is None:
        render_avatar_image_panel(stats, compact=True)
        return

    level = int(stats.get("level", 1))
    evo = evolution_name(branch, level)

    try:
        from app import get_fast_snapshot
        summary = get_fast_snapshot().get("summary", {})
    except Exception:
        summary = workout_summary(load_log())

    lvl, xp_now, xp_need = current_level_xp(summary)
    pct = max(0, min((xp_now / xp_need) * 100, 100))

    st.markdown(
        f"""
        <div class="home-avatar-card">
            <div class="home-avatar-top">
                <div>
                    <div class="avatar-kicker">CURRENT FORM</div>
                    <div class="home-avatar-title">{evo}</div>
                    <div class="home-avatar-sub">{branch_display_name(branch)} • Level {level}</div>
                    <div class="home-rarity">{rarity_badge_html(level)}</div>
                </div>
                <div class="home-avatar-level">LVL {level}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    col_img, col_stats = st.columns([0.78, 1.0], vertical_alignment="center")
    with col_img:
        st.markdown('<div class="home-avatar-img-wrap">', unsafe_allow_html=True)
        st.image(avatar_img, use_container_width=True)
        st.markdown('</div>', unsafe_allow_html=True)

    with col_stats:
        st.markdown(
            f"""
            <div class="home-avatar-statbox">
                <div class="home-mini-row"><span>⚔️ STR</span><b>{int(stats.get("strength_score", 0))}</b></div>
                <div class="home-mini-row"><span>🦍 SIZE</span><b>{int(stats.get("size_score", 0))}</b></div>
                <div class="home-mini-row"><span>💎 LEAN</span><b>{int(stats.get("leanness_score", 0))}</b></div>
                <div class="home-mini-row"><span>🔥 AESTH</span><b>{int(stats.get("aesthetic_score", 0))}</b></div>
                <div class="home-xp-label">{xp_now} / {xp_need} XP</div>
                <div class="avatar-track home-xp-track">
                    <div class="avatar-fill" style="--avatar-progress:{pct}%;"></div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown("</div>", unsafe_allow_html=True)
