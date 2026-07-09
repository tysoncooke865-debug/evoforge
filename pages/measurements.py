from datetime import date, datetime

import pandas as pd
import streamlit as st

from domain.measurements import load_measurements, save_measurements, latest_measurements
from domain.bodyweight import latest_bodyweight_value
from ui.components import page_hero


def render():
    page_hero("Body Measurements", "Track proportions, waist, arms, chest, shoulders and more.", "Tracking")
    st.info("Log measurements to track proportions and help the app generate better physique-focused training plans.")

    latest = latest_measurements()
    latest_bw = latest_bodyweight_value() or float(latest.get("bodyweight", 76.0) or 76.0)

    c1, c2 = st.columns(2)
    with c1:
        m_date = st.date_input("Date", value=date.today(), key="measure_date")
        bodyweight = st.number_input("Bodyweight kg", min_value=0.0, step=0.1, value=float(latest_bw or 76.0))
        wrist = st.number_input("Wrist cm", min_value=0.0, step=0.1, value=float(latest.get("wrist_cm", 0) or 0))
        forearm = st.number_input("Forearm cm", min_value=0.0, step=0.1, value=float(latest.get("forearm_cm", 0) or 0))
        bicep = st.number_input("Bicep cm", min_value=0.0, step=0.1, value=float(latest.get("bicep_cm", 0) or 0))
        chest = st.number_input("Chest cm", min_value=0.0, step=0.1, value=float(latest.get("chest_cm", 0) or 0))
    with c2:
        waist = st.number_input("Waist cm", min_value=0.0, step=0.1, value=float(latest.get("waist_cm", 0) or 0))
        hips = st.number_input("Hips cm", min_value=0.0, step=0.1, value=float(latest.get("hips_cm", 0) or 0))
        thigh = st.number_input("Thigh cm", min_value=0.0, step=0.1, value=float(latest.get("thigh_cm", 0) or 0))
        calf = st.number_input("Calf cm", min_value=0.0, step=0.1, value=float(latest.get("calf_cm", 0) or 0))
        shoulders = st.number_input("Shoulders cm", min_value=0.0, step=0.1, value=float(latest.get("shoulders_cm", 0) or 0))
        neck = st.number_input("Neck cm", min_value=0.0, step=0.1, value=float(latest.get("neck_cm", 0) or 0))

    notes = st.text_input("Notes", placeholder="Morning, no pump, relaxed, etc.")

    if st.button("Save Measurements", type="primary"):
        save_measurements({
            "date": str(m_date),
            "bodyweight": bodyweight,
            "wrist_cm": wrist,
            "forearm_cm": forearm,
            "bicep_cm": bicep,
            "chest_cm": chest,
            "waist_cm": waist,
            "hips_cm": hips,
            "thigh_cm": thigh,
            "calf_cm": calf,
            "shoulders_cm": shoulders,
            "neck_cm": neck,
            "notes": notes,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        })
        st.session_state.just_saved_message = "MEASUREMENTS SAVED"
        st.rerun()

    st.subheader("Measurement History")
    mlog = load_measurements()
    if mlog.empty:
        st.info("No measurements logged yet.")
    else:
        st.dataframe(mlog.sort_values("date", ascending=False), width="stretch")
        chart_cols = [c for c in ["bodyweight", "bicep_cm", "chest_cm", "waist_cm", "shoulders_cm"] if c in mlog.columns]
        if chart_cols:
            for col in chart_cols:
                mlog[col] = pd.to_numeric(mlog[col], errors="coerce").fillna(0)
            st.line_chart(mlog, x="date", y=chart_cols)
