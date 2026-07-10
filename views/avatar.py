import pandas as pd
import streamlit as st

from domain.avatar_stats import (
    calculate_avatar_stats, avatar_asset_for_stats, branch_display_name,
    load_avatar_progression, save_avatar_snapshot, default_avatar_summary,
)
from services.ai_avatar import run_ai_avatar_analysis
from ui.nav import route_button
from ui.components import page_hero, compact_metric, render_evolution_showcase
from ui.avatar_cards import render_avatar_image_panel, render_evolution_path, render_next_evolution_card, render_avatar_stat


def render():
    # The hero comes first, on every page. This one used to render the evolution
    # showcase above its own title (J1). `tools/verify_ui.py` now asserts the
    # ordering, so it cannot come back.
    page_hero("Ascension Chamber", "Your real training unlocks forms, branches, stats and next evolutions.", "RPG Mode")
    aqa1, aqa2, aqa3 = st.columns(3)
    with aqa1:
        route_button("Train to Level Up →", "Today", key="qol_avatar_missions")
    with aqa2:
        route_button("Update Body Stats →", "Measurements", key="qol_avatar_measurements")
    with aqa3:
        route_button("Oracle Analysis →", "Physique", key="qol_avatar_oracle")

    # One call, not two. `calculate_avatar_stats()` reads the whole workout log.
    stats = calculate_avatar_stats()
    branch, stage, avatar_path = avatar_asset_for_stats(stats)
    stats["avatar_branch"] = branch

    render_evolution_showcase(stats)

    render_avatar_image_panel(stats, compact=False)

    st.divider()

    render_evolution_path(stats)

    st.divider()

    render_next_evolution_card(stats)

    c1, c2, c3 = st.columns(3)
    with c1:
        compact_metric("Branch", branch_display_name(branch), "auto-detected class path")
    with c2:
        compact_metric("Build", stats["build_type"], f"BW: {stats.get('bodyweight', 0):.1f}kg")
    with c3:
        compact_metric("Weak Point", stats["weak_point_focus"], "next focus")

    with st.expander("Detailed Character Stats", expanded=False):
        st.caption("Scores are blended from strength, body fat, physique ratings, cardio and logged training.")
        render_avatar_stat("⚔️ Strength", stats["strength_score"])
        render_avatar_stat("🦍 Size", stats["size_score"])
        render_avatar_stat("💎 Leanness", stats["leanness_score"])
        render_avatar_stat("❤️ Conditioning", stats["conditioning_score"])
        render_avatar_stat("🔥 Aesthetic", stats["aesthetic_score"])

    st.subheader("Avatar Summary")
    latest_avatar = load_avatar_progression()
    clean_summary = ""
    if not latest_avatar.empty and "ai_summary" in latest_avatar.columns:
        summaries = latest_avatar["ai_summary"].dropna().astype(str)
        summaries = summaries[~summaries.str.lower().str.contains("test avatar row", na=False)]
        if not summaries.empty:
            clean_summary = summaries.iloc[-1]

    if clean_summary:
        st.write(clean_summary)
    else:
        st.write(default_avatar_summary(stats))

    with st.expander("AI Avatar Coach", expanded=False):
        model_name = st.text_input("AI model for avatar analysis", value="gpt-5.1", key="avatar_model")
        col_a, col_b = st.columns(2)
        with col_a:
            if st.button("Generate AI Avatar Analysis", type="primary", width="stretch"):
                with st.spinner("Evolving avatar profile..."):
                    ai_data, err = run_ai_avatar_analysis(stats, model_name)
                if err:
                    st.error(err)
                else:
                    stats["character_class"] = ai_data.get("character_class", stats["character_class"])
                    stats["build_type"] = ai_data.get("build_type", stats["build_type"])
                    stats["weak_point_focus"] = ai_data.get("weak_point_focus", stats["weak_point_focus"])
                    stats["ai_summary"] = ai_data.get("ai_summary", default_avatar_summary(stats))
                    st.session_state["last_avatar_ai"] = ai_data
                    save_avatar_snapshot({k: stats[k] for k in [
                        "date", "level", "rank", "character_class", "build_type",
                        "strength_score", "size_score", "leanness_score", "conditioning_score",
                        "aesthetic_score", "weak_point_focus", "ai_summary", "timestamp"
                    ]})
                    st.session_state.just_saved_message = "AVATAR EVOLVED"
                    st.rerun()

        with col_b:
            if st.button("Save Avatar Core Readout", type="secondary", width="stretch"):
                stats["ai_summary"] = default_avatar_summary(stats)
                save_avatar_snapshot({k: stats[k] for k in [
                    "date", "level", "rank", "character_class", "build_type",
                    "strength_score", "size_score", "leanness_score", "conditioning_score",
                    "aesthetic_score", "weak_point_focus", "ai_summary", "timestamp"
                ]})
                st.session_state.just_saved_message = "AVATAR SNAPSHOT SAVED"
                st.rerun()

        ai_last = st.session_state.get("last_avatar_ai", None)
        if ai_last:
            st.subheader("Next Evolution")
            st.info(ai_last.get("next_evolution", "Keep progressing your main weak point."))
            st.subheader("7-Day Quest")
            st.success(ai_last.get("training_quest", "Complete your planned sessions and log every set."))

    with st.expander("Developer: Avatar Timeline", expanded=False):
        timeline = load_avatar_progression()
        if timeline.empty:
            st.info("No avatar snapshots yet. Save one to start your evolution timeline.")
        else:
            chart_df = timeline.copy()
            for col in ["strength_score", "size_score", "leanness_score", "conditioning_score", "aesthetic_score"]:
                chart_df[col] = pd.to_numeric(chart_df[col], errors="coerce").fillna(0)
            st.line_chart(chart_df, x="date", y=["strength_score", "size_score", "leanness_score", "conditioning_score", "aesthetic_score"])
