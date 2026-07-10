import streamlit as st

from config.constants import ACHIEVEMENTS
from domain.achievements import load_achievements, check_achievements
from ui.components import page_hero


def render():
    page_hero("Achievements", "Unlocked milestones and progression badges.", "Trophies")
    st.info("Achievements auto-unlock from your existing logs, bodyweight, body fat, cardio, targets, and profile level.")

    unlocked = check_achievements()
    if unlocked:
        st.session_state.achievement_message = " • ".join(unlocked)
        st.rerun()

    ach = load_achievements()
    unlocked_ids = set(ach["achievement_id"].astype(str).dropna().tolist()) if not ach.empty else set()

    st.metric("Unlocked", f"{len(unlocked_ids)}/{len(ACHIEVEMENTS)}")

    categories = {
        "Strength": ["bench", "squat"],
        "Cut/Bulk/Body": ["bw", "bulk", "cut", "bf", "body"],
        "Cardio": ["cardio", "boxing"],
        "Consistency": ["streak", "ppppla", "workout", "set"],
        "Muscle Volume": ["chest", "back", "delts", "arms", "legs", "abs"],
        "Rank": ["aesthetic", "elite", "chad", "adam"],
        "All": [""],
    }

    category = st.selectbox("Category", list(categories.keys()))
    filters = categories[category]

    for achievement_id, (name, desc) in ACHIEVEMENTS.items():
        if category != "All" and not any(f in achievement_id for f in filters):
            continue

        unlocked_status = achievement_id in unlocked_ids
        status = "✅ UNLOCKED" if unlocked_status else "🔒 LOCKED"
        locked_class = "" if unlocked_status else " is-locked"

        st.markdown(
            f"""
            <div class="dashboard-card{locked_class}">
                <div class="nw-card-title">{name} — {status}</div>
                <div class="nw-small">{desc}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
