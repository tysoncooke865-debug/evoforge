from datetime import date, datetime

import pandas as pd
import streamlit as st

from domain.bodyweight import load_bodyweight_log, save_bodyweight_row
from ui.components import page_hero


def render():
    page_hero("Bodyweight", "Track scale weight across cut and bulk phases.", "Scale")
    bw_df = load_bodyweight_log()
    bw_date = st.date_input("Date", value=date.today())
    bw = st.number_input("Bodyweight kg", min_value=0.0, step=0.1)
    if st.button("Save Bodyweight", type="primary"):
        if bw > 0:
            save_bodyweight_row({"date": str(bw_date), "bodyweight": bw, "timestamp": datetime.now().isoformat(timespec="seconds")})
            st.session_state.just_saved_message = "BODYWEIGHT SAVED — STATS UPDATED"
            st.rerun()
    if not bw_df.empty:
        bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
        st.metric("Latest bodyweight", f"{bw_df.iloc[-1]['bodyweight']:.1f} kg")
        st.line_chart(bw_df, x="date", y="bodyweight")
        st.dataframe(bw_df.sort_values("date", ascending=False), width="stretch")
