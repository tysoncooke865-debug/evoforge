from datetime import date, datetime

import pandas as pd
import streamlit as st

from domain.bodyweight import load_bodyweight_log
from domain.bodyfat import (
    navy_body_fat_male, bodyfat_outputs, safe_kg, save_bodyfat_estimate, latest_bodyfat_mid,
    load_bodyfat_log,
)
from domain.targets import get_target
from services.ai_bodyfat import run_ai_bodyfat_estimate
from ui.components import render_target_bar


def render():
    st.header("Body Fat Estimator")
    st.info("Use this as a trend tool, not an exact medical measurement. For best results, use the same lighting, pose, and time of day each check.")

    mode = st.radio("Estimate method", ["Measurement estimate", "AI photo estimate", "Combined estimate"], horizontal=True)

    latest_bw = 0.0
    bw_df = load_bodyweight_log()
    if not bw_df.empty:
        bw_df["bodyweight"] = pd.to_numeric(bw_df["bodyweight"], errors="coerce").fillna(0)
        latest_bw = float(bw_df.iloc[-1]["bodyweight"])

    col1, col2 = st.columns(2)
    with col1:
        estimate_date = st.date_input("Date", value=date.today(), key="bf_date")
        weight_kg = st.number_input("Bodyweight kg", min_value=0.0, step=0.1, value=float(latest_bw) if latest_bw else 76.0)
        height_cm = st.number_input("Height cm", min_value=100.0, max_value=230.0, step=0.5, value=183.5)
    with col2:
        waist_cm = st.number_input("Waist at navel cm (optional for AI)", min_value=0.0, step=0.5, value=0.0)
        neck_cm = st.number_input("Neck cm (optional for AI)", min_value=0.0, step=0.5, value=0.0)
        target_bf = st.number_input("Target BF%", min_value=5.0, max_value=25.0, step=0.5, value=10.0)

    navy_bf = None
    ai_data = None

    if mode in ["Measurement estimate", "Combined estimate"]:
        st.subheader("Measurement Estimate")

        if waist_cm <= 0 or neck_cm <= 0:
            navy_bf = None
            st.warning("Enter waist and neck measurements to use the measurement estimate. AI photo mode does not require them.")
        else:
            navy_bf = navy_body_fat_male(height_cm, waist_cm, neck_cm)

        if navy_bf is None and waist_cm > 0 and neck_cm > 0:
            st.warning("Enter valid waist/neck/height values. Waist must be larger than neck.")
        else:
            bf_low = max(navy_bf - 1.0, 3)
            bf_high = navy_bf + 1.0
            fat_mass, lean_mass, target_weight, fat_to_lose = bodyfat_outputs(weight_kg, navy_bf, target_bf)

            c1, c2, c3 = st.columns(3)
            c1.metric("Estimated BF%", f"{navy_bf:.1f}%")
            c2.metric("Lean Mass", f"{lean_mass:.1f}kg")
            c3.metric(f"{target_bf:.1f}% Target", f"{safe_kg(target_weight)}")

            st.markdown(
                f"""
                <div class="mission-card">
                    <div class="mission-title">BODY FAT RANGE</div>
                    <div class="progress-track">
                        <div class="progress-fill" style="--progress: {min(navy_bf * 4, 100):.1f}%;"></div>
                    </div>
                    <div class="progress-label">Measurement range: {bf_low:.1f}% - {bf_high:.1f}% • Fat to lose to {target_bf:.1f}%: {safe_kg(fat_to_lose)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            if st.button("Save Measurement Estimate", type="primary"):
                save_bodyfat_estimate({
                    "date": str(estimate_date),
                    "method": "Measurement",
                    "bodyweight": weight_kg,
                    "height_cm": height_cm,
                    "waist_cm": waist_cm,
                    "neck_cm": neck_cm,
                    "bf_low": round(bf_low, 2),
                    "bf_high": round(bf_high, 2),
                    "bf_mid": round(navy_bf, 2),
                    "confidence": "medium",
                    "notes": f"US Navy-style measurement estimate. Target {target_bf}% weight: {safe_kg(target_weight)}.",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                })
                st.session_state.just_saved_message = "BODY FAT ESTIMATE SAVED"
                st.rerun()

    if mode in ["AI photo estimate", "Combined estimate"]:
        st.subheader("AI Photo Estimate")
        st.caption("Requires OpenAI API key. Upload front/back physique photos. Waist/neck are optional and ignored unless you enter them.")

        c1, c2 = st.columns(2)
        with c1:
            front_photo = st.file_uploader("Front photo", type=["jpg", "jpeg", "png", "webp"], key="front_photo")
        with c2:
            back_photo = st.file_uploader("Back photo", type=["jpg", "jpeg", "png", "webp"], key="back_photo")

        c3, c4, c5 = st.columns(3)
        with c3:
            lighting = st.selectbox("Lighting", ["Normal", "Harsh/good gym lighting", "Dim", "Outdoor", "Unknown"])
        with c4:
            pump_status = st.selectbox("Pump", ["No pump", "Light pump", "Full pump", "Unknown"])
        with c5:
            time_of_day = st.selectbox("Time", ["Morning", "Afternoon", "Night", "Unknown"])

        model_name = st.text_input("OpenAI model", value="gpt-5.1", help="Use a vision-capable model available to your API account.")

        if st.button("Run AI Photo Estimate", type="primary"):
            with st.spinner("Analysing physique photos..."):
                ai_data, err = run_ai_bodyfat_estimate(
                    front_photo, back_photo, height_cm, weight_kg, waist_cm, neck_cm, lighting, pump_status, time_of_day, model_name
                )

            if err:
                st.error(err)
            else:
                st.session_state["last_ai_bf"] = ai_data
                st.session_state.just_saved_message = "AI BODY FAT ESTIMATE COMPLETE"
                st.rerun()

        ai_data = st.session_state.get("last_ai_bf", None)
        if ai_data:
            bf_low = float(ai_data["bf_low"])
            bf_high = float(ai_data["bf_high"])
            bf_mid = float(ai_data["bf_mid"])
            fat_mass, lean_mass, target_weight, fat_to_lose = bodyfat_outputs(weight_kg, bf_mid, target_bf)

            c1, c2, c3 = st.columns(3)
            c1.metric("AI BF Range", f"{bf_low:.1f}-{bf_high:.1f}%")
            c2.metric("AI Midpoint", f"{bf_mid:.1f}%")
            c3.metric("Confidence", str(ai_data.get("confidence", "unknown")).title())

            if waist_cm > 0 and neck_cm > 0:
                st.caption(f"Measurement data supplied: waist {waist_cm:.1f}cm, neck {neck_cm:.1f}cm")
            else:
                st.caption("Measurement data: not supplied — AI estimate used photos + height/weight only.")

            st.markdown(
                f"""
                <div class="mission-card">
                    <div class="mission-title">AI PHOTO BODY FAT ESTIMATE</div>
                    <div class="progress-track">
                        <div class="progress-fill" style="--progress: {min(bf_mid * 4, 100):.1f}%;"></div>
                    </div>
                    <div class="progress-label">{bf_low:.1f}% - {bf_high:.1f}% • Target {target_bf:.1f}% weight: {safe_kg(target_weight)} • Fat to lose: {safe_kg(fat_to_lose)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            st.write(f"**Notes:** {ai_data.get('notes', '')}")
            if ai_data.get("fat_storage"):
                st.write(f"**Fat storage:** {ai_data.get('fat_storage')}")
            if ai_data.get("ten_percent_notes"):
                st.write(f"**10% notes:** {ai_data.get('ten_percent_notes')}")

            if st.button("Save AI Estimate", type="primary"):
                save_bodyfat_estimate({
                    "date": str(estimate_date),
                    "method": "AI Photo",
                    "bodyweight": weight_kg,
                    "height_cm": height_cm,
                    "waist_cm": waist_cm,
                    "neck_cm": neck_cm,
                    "bf_low": round(bf_low, 2),
                    "bf_high": round(bf_high, 2),
                    "bf_mid": round(bf_mid, 2),
                    "confidence": ai_data.get("confidence", ""),
                    "notes": ai_data.get("notes", ""),
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                })
                st.session_state.just_saved_message = "AI BODY FAT ESTIMATE SAVED"
                st.rerun()

    if mode == "Combined estimate":
        ai_data = st.session_state.get("last_ai_bf", None)
        if navy_bf is None:
            st.caption("Combined estimate needs waist and neck measurements plus an AI estimate.")
        if navy_bf is not None and ai_data:
            ai_mid = float(ai_data["bf_mid"])
            combined_mid = (navy_bf + ai_mid) / 2
            combined_low = min(navy_bf - 1, float(ai_data["bf_low"]))
            combined_high = max(navy_bf + 1, float(ai_data["bf_high"]))
            fat_mass, lean_mass, target_weight, fat_to_lose = bodyfat_outputs(weight_kg, combined_mid, target_bf)

            st.subheader("Combined Estimate")
            c1, c2, c3 = st.columns(3)
            c1.metric("Combined Range", f"{combined_low:.1f}-{combined_high:.1f}%")
            c2.metric("Combined Mid", f"{combined_mid:.1f}%")
            c3.metric(f"{target_bf:.1f}% Target", f"{safe_kg(target_weight)}")

            if st.button("Save Combined Estimate", type="primary"):
                save_bodyfat_estimate({
                    "date": str(estimate_date),
                    "method": "Combined",
                    "bodyweight": weight_kg,
                    "height_cm": height_cm,
                    "waist_cm": waist_cm,
                    "neck_cm": neck_cm,
                    "bf_low": round(combined_low, 2),
                    "bf_high": round(combined_high, 2),
                    "bf_mid": round(combined_mid, 2),
                    "confidence": "medium",
                    "notes": f"Combined measurement + AI estimate. Target {target_bf}% weight: {safe_kg(target_weight)}.",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                })
                st.session_state.just_saved_message = "COMBINED BODY FAT ESTIMATE SAVED"
                st.rerun()

    st.subheader("Body Fat Target")
    render_target_bar("BODY FAT TARGET", latest_bodyfat_mid(), get_target("Body Fat", "Body Fat %"), "%", lower_is_better=True)

    st.subheader("Body Fat History")
    bf_log = load_bodyfat_log()
    if bf_log.empty:
        st.info("No body fat estimates saved yet.")
    else:
        bf_log["bf_mid"] = pd.to_numeric(bf_log["bf_mid"], errors="coerce").fillna(0)
        st.line_chart(bf_log, x="date", y="bf_mid")
        st.dataframe(bf_log.sort_values("date", ascending=False), use_container_width=True)
