import streamlit as st

from domain.profile import rank_name
from domain.physique_ratings import safe_num
from domain.xp_leveling import avatar_stage_rows
from domain.avatar_stats import (
    avatar_asset_for_stats, evolution_name, branch_display_name, rarity_badge_html,
    next_evolution_info, rarity_slug,
)
from ui.avatar_images import (
    avatar_stage_html, get_avatar_image_object, make_locked_silhouette_image,
)
from ui.escape import esc


def render_avatar_stat(label, value, delta=None):
    """A single labelled stat bar. `delta` renders a rising +N surge chip."""
    value = int(max(0, min(safe_num(value, 0), 100)))
    delta_html = ""
    if delta:
        delta_html = f'<span class="ef-stat-delta">+{int(delta)}</span>'
    st.markdown(
        f"""
        <div class="avatar-stat">
            <div class="avatar-stat-top">
                <span>{label}</span>
                <b>{value}{delta_html}</b>
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
    level = int(stats.get("level", 1))
    rarity = rarity_slug(level)

    stage_html = avatar_stage_html(path, rarity=rarity, size="lg", alt="Current form")
    if not stage_html:
        st.error("Avatar image could not load. Check the avatar_assets folder.")
        st.write(f"Expected path: `{path}`")
        return

    evo = evolution_name(branch, level)
    branch_name = branch_display_name(branch)
    rank = str(stats.get("rank", rank_name(level)))
    weak = str(stats.get("weak_point_focus", "Balanced"))

    col_img, col_stats = st.columns([1.05, 0.95], vertical_alignment="center")

    with col_img:
        st.markdown(
            f'<div class="avatar-image-native-wrap rarity-{rarity}">{stage_html}</div>',
            unsafe_allow_html=True,
        )

    with col_stats:
        st.markdown(
            f"""
            <div class="avatar-side-card-clean">
                <div class="avatar-kicker">CURRENT FORM</div>
                {rarity_badge_html(level)}
                <div class="avatar-clean-title">{esc(evo)}</div>
                <div class="avatar-clean-sub">{esc(branch_name)} • Level {level}</div>
                <div class="avatar-clean-pills">
                    <span>{esc(rank)}</span>
                    <span>Focus: {esc(weak)}</span>
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

    # The preview shows the NEXT form. While locked it is baked into a black
    # silhouette with a cyan rim before rendering.
    preview_stats = dict(stats)
    preview_stats["level"] = int(target_level)
    _, _, preview_path = avatar_asset_for_stats(preview_stats)
    preview_img = get_avatar_image_object(preview_path)

    complete_count = sum(1 for _, _, _, complete in reqs if complete)
    total_count = max(1, len(reqs))
    ready_pct = int((complete_count / total_count) * 100)
    unlocked = level >= int(target_level)

    if preview_img is not None and not unlocked:
        preview_img = make_locked_silhouette_image(preview_img)

    preview_rarity = rarity_slug(target_level)
    stage_html = ""
    if preview_img is not None:
        stage_html = avatar_stage_html(
            preview_img,
            rarity=preview_rarity,
            size="md",
            locked=not unlocked,
            alt=f"Next form: {target_name}",
        )

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
            <div class="next-evo-ready-track">
                <div class="next-evo-ready-fill" style="--progress:{ready_pct}%;"></div>
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
        preview_body = stage_html or '<div class="locked-silhouette">?</div>'

        reward_text = "+ Armour • + Aura • + Title"
        if branch == "mass":
            reward_text = "+ Heavy Armour • + Power Aura • + Titan Title"
        elif branch == "hybrid":
            reward_text = "+ Tactical Gear • + Speed Aura • + Apex Title"

        st.markdown(
            f"""
            <div class="true-silhouette-panel {stage_class}">
                <div class="locked-badge">{badge}</div>
                {preview_body}
                <div class="hidden-class">{mystery}</div>
                <div class="unlock-reward">Reward: {reward_text}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    with col_req:
        rows = []
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
            done = "is-complete" if complete else ""
            rows.append(
                f'<div class="evo-req {done}">'
                f'<div class="evo-req-row">'
                f'<div class="evo-req-label">{icon} {label}</div>'
                f'<div class="evo-req-value">{current_label} / {target_label}</div>'
                f"</div>"
                f'<div class="avatar-track evo-track">'
                f'<div class="avatar-fill" style="--avatar-progress:{progress}%;"></div>'
                f"</div>"
                f"</div>"
            )
        st.markdown(f'<div class="evo-req-list">{"".join(rows)}</div>', unsafe_allow_html=True)


def render_workout_xp_toast():
    """Render the +XP burst set by mark_xp_gain(), then clear the flag.

    Must be called once per run from the router; nothing else reads
    session_state["show_xp_toast"].
    """
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

    nodes = []
    for r in rows:
        status = "✅" if r["unlocked"] else "🔒"
        current = "current-evo" if r["current"] else ""
        locked = "locked-evo" if not r["unlocked"] else ""
        nodes.append(
            f'<div class="evolution-node {current} {locked}">'
            f'<div class="evo-node-icon">{status}</div>'
            f'<div class="evo-node-name">{r["name"]}</div>'
            f'<div class="evo-node-level">LVL {r["level"]}</div>'
            f"</div>"
        )

    # One markdown call: the grid must actually contain its nodes as children,
    # otherwise `.evolution-path-grid` lays out nothing.
    st.markdown(
        f'<div class="evolution-path-card">'
        f'<div class="avatar-kicker">EVOLUTION PATH</div>'
        f'<div class="evolution-path-title">{branch_display_name(branch)}</div>'
        f'<div class="evolution-path-grid">{"".join(nodes)}</div>'
        f"</div>",
        unsafe_allow_html=True,
    )
