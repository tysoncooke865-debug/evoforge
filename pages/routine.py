import streamlit as st

from config.constants import ROUTINE


def render():
    st.header("PPPPLA Routine")
    st.info("Strength bench = heavy top set + back-off sets. Paused bench = lighter controlled bench with a 1-2 second pause on the chest.")
    for day_num, (workout, exercises) in enumerate(ROUTINE.items(), start=1):
        st.subheader(f"Day {day_num}: {workout}")
        if workout == "Rest":
            st.write("Rest / walking / mobility")
        else:
            for exercise, sets, reps in exercises:
                st.write(f"**{exercise}** — {sets} sets × {reps}")
