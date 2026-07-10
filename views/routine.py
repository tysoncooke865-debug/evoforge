import streamlit as st

from config.constants import ROUTINE
from ui.components import page_hero


def render():
    page_hero("PPPPLA Routine", "Your six-day push / pull / legs / aesthetics split.", "Plan")
    st.info("Strength bench = heavy top set + back-off sets. Paused bench = lighter controlled bench with a 1-2 second pause on the chest.")

    for day_num, (workout, exercises) in enumerate(ROUTINE.items(), start=1):
        if workout == "Rest":
            rows = '<div class="nw-small">Rest / walking / mobility</div>'
            total = "recovery"
        else:
            rows = "".join(
                f'<div class="nw-small"><b>{exercise}</b> — {sets} sets × {reps}</div>'
                for exercise, sets, reps in exercises
            )
            set_count = sum(sets for _, sets, _ in exercises)
            total = f"{len(exercises)} exercises · {set_count} working sets"

        # ONE balanced markdown call per card. A <div> split across two calls does
        # not nest -- Streamlit sanitizes each call and auto-closes the tag.
        st.markdown(
            f"""
            <div class="dashboard-card">
                <div class="nw-card-title">Day {day_num}: {workout}</div>
                <div class="progress-helper">{total}</div>
                {rows}
            </div>
            """,
            unsafe_allow_html=True,
        )
