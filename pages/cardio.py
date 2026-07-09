from datetime import date, datetime

import pandas as pd
import streamlit as st

from domain.cardio import load_cardio_log, save_cardio_row
from domain.achievements import check_achievements
from ui.components import page_hero


def render():
    page_hero("Cardio Tracker", "Log conditioning, steps, incline work, boxing or walks.", "Engine")
    cardio = load_cardio_log()
    c_date = st.date_input("Date", value=date.today())
    c_type = st.selectbox("Type", ["Treadmill incline walk", "Outdoor walk", "Run", "Bike", "Stairmaster", "Boxing", "Other"])
    col1, col2 = st.columns(2)
    with col1:
        minutes = st.number_input("Minutes", min_value=0.0, step=5.0)
        distance = st.number_input("Distance km", min_value=0.0, step=0.1)
        incline = st.number_input("Incline %", min_value=0.0, step=0.5)
    with col2:
        speed = st.number_input("Speed km/h", min_value=0.0, step=0.1)
        calories = st.number_input("Calories", min_value=0.0, step=10.0)
    notes = st.text_input("Notes", placeholder="Example: 12% incline, 4.6km/h, post-pull")

    if st.button("Save Cardio", type="primary"):
        if minutes > 0:
            save_cardio_row({"date": str(c_date), "type": c_type, "minutes": minutes, "distance_km": distance, "incline": incline, "speed": speed, "calories": calories, "notes": notes, "timestamp": datetime.now().isoformat(timespec="seconds")})
            unlocked = check_achievements()
            st.session_state.just_saved_message = "CARDIO SAVED — ENGINE UPDATED"
            if unlocked:
                st.session_state.achievement_message = " • ".join(unlocked)
            st.rerun()
        else:
            st.warning("Enter minutes first.")

    if not cardio.empty:
        cardio["minutes"] = pd.to_numeric(cardio["minutes"], errors="coerce").fillna(0)
        cardio["distance_km"] = pd.to_numeric(cardio["distance_km"], errors="coerce").fillna(0)
        cardio["calories"] = pd.to_numeric(cardio["calories"], errors="coerce").fillna(0)
        c1, c2, c3 = st.columns(3)
        c1.metric("Total minutes", f"{cardio['minutes'].sum():.0f}")
        c2.metric("Total km", f"{cardio['distance_km'].sum():.1f}")
        c3.metric("Calories", f"{cardio['calories'].sum():.0f}")
        daily = cardio.groupby("date", as_index=False)["minutes"].sum()
        st.line_chart(daily, x="date", y="minutes")
        st.dataframe(cardio.sort_values("date", ascending=False), use_container_width=True)
