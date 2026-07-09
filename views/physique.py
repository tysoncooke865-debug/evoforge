import json
from datetime import date, datetime

import streamlit as st

from config.constants import FALLBACK_AESTHETIC_PLAN
from domain.measurements import latest_measurements
from domain.bodyfat import latest_bodyfat_mid
from domain.bodyweight import latest_bodyweight_value
from domain.workouts import current_exercise_best_1rm
from domain.physique_ratings import save_physique_rating, load_physique_ratings
from domain.custom_plan import save_fallback_custom_plan, save_ai_custom_plan, load_custom_plan
from services.ai_physique import run_ai_physique_rating, run_ai_custom_plan_from_physique
from ui.nav import route_button
from ui.components import page_hero


def render():
    oqa1, oqa2, oqa3 = st.columns(3)
    with oqa1:
        route_button("Get Body Fat Estimate →", "Body Fat", key="qol_physique_bodyfat")
    with oqa2:
        route_button("Update Measurements →", "Measurements", key="qol_physique_measurements")
    with oqa3:
        route_button("Use Custom Plan →", "Today", key="qol_physique_today")

    page_hero("AI Physique Rating", "Upload photos, rate weak points, generate a smarter program.", "AI Coach")
    st.info("Upload physique photos to get a physique score, leanness score, weak points, and a custom workout plan suggestion.")

    latest_m = latest_measurements()
    latest_bf = latest_bodyfat_mid()
    latest_bw = latest_bodyweight_value()

    c1, c2, c3 = st.columns(3)
    with c1:
        front_photo = st.file_uploader("Front photo", type=["jpg", "jpeg", "png", "webp"], key="phys_front")
    with c2:
        side_photo = st.file_uploader("Side photo", type=["jpg", "jpeg", "png", "webp"], key="phys_side")
    with c3:
        back_photo = st.file_uploader("Back photo", type=["jpg", "jpeg", "png", "webp"], key="phys_back")

    model_name = st.text_input("OpenAI model", value="gpt-5.1", key="phys_model")

    stats = {
        "bodyweight_kg": latest_bw,
        "bodyfat_estimate": latest_bf,
        "measurements": latest_m,
        "bench_e1rm": current_exercise_best_1rm("Barbell Bench Press (Strength)"),
        "squat_e1rm": current_exercise_best_1rm("Barbell Back Squat"),
    }

    if st.button("Run AI Physique Rating", type="primary"):
        with st.spinner("Rating physique and analysing weak points..."):
            result, err = run_ai_physique_rating(front_photo, side_photo, back_photo, stats, model_name)
        if err:
            st.error(err)
        else:
            st.session_state["last_physique_rating"] = result
            st.session_state.just_saved_message = "PHYSIQUE RATING COMPLETE"
            st.rerun()

    rating = st.session_state.get("last_physique_rating", None)

    if rating:
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Physique", f"{float(rating['physique_score']):.1f}/15")
        c2.metric("Leanness", f"{float(rating['leanness_score']):.1f}/15")
        c3.metric("Symmetry", f"{float(rating['symmetry_score']):.1f}/15")
        c4.metric("Muscularity", f"{float(rating['muscularity_score']):.1f}/15")

        st.write(f"**Confidence:** {str(rating.get('confidence', 'unknown')).title()}")
        st.write(f"**Summary:** {rating.get('summary', '')}")

        st.subheader("Weak Points")
        for point in rating.get("weak_points", []):
            st.write(f"- {point}")

        st.subheader("What To Improve")
        for point in rating.get("improvements", []):
            st.write(f"- {point}")

        if st.button("Save Physique Rating", type="primary"):
            save_physique_rating({
                "date": str(date.today()),
                "physique_score": rating.get("physique_score"),
                "leanness_score": rating.get("leanness_score"),
                "symmetry_score": rating.get("symmetry_score"),
                "muscularity_score": rating.get("muscularity_score"),
                "confidence": rating.get("confidence"),
                "weak_points": json.dumps(rating.get("weak_points", [])),
                "improvements": json.dumps(rating.get("improvements", [])),
                "summary": rating.get("summary"),
                "timestamp": datetime.now().isoformat(timespec="seconds"),
            })
            st.session_state.just_saved_message = "PHYSIQUE RATING SAVED"
            st.rerun()

        st.subheader("Generate Custom Workout Plan")
        goal = st.selectbox(
            "Goal",
            ["Aesthetic / lean bulk", "Cutting / maintain muscle", "Bench strength focus", "V-taper focus", "Arms/Delts specialization", "Upper chest specialization"]
        )

        st.caption("This uses the AI physique rating + measurements + a larger exercise library to build a weak-point plan. It will not simply copy your current PPPPLA.")

        if st.button("Generate AI Custom Plan From Physique Analysis", type="primary"):
            with st.spinner("AI is building a custom weak-point plan..."):
                ai_plan, err = run_ai_custom_plan_from_physique(
                    rating=rating,
                    measurements=latest_measurements(),
                    goals=goal,
                    model_name=model_name,
                )

            if err:
                st.warning(err)
                st.info("Using fallback weak-point aesthetic plan instead.")
                save_fallback_custom_plan(FALLBACK_AESTHETIC_PLAN)
                st.session_state.just_saved_message = "FALLBACK CUSTOM PLAN GENERATED"
                st.rerun()
            else:
                ok = save_ai_custom_plan(ai_plan)
                if ok:
                    st.session_state["last_ai_plan"] = ai_plan
                    st.session_state.just_saved_message = "AI CUSTOM WORKOUT PLAN GENERATED"
                    st.rerun()
                else:
                    st.error("AI returned a plan, but no exercises could be saved.")

        last_plan = st.session_state.get("last_ai_plan", None)
        if last_plan:
            st.subheader(last_plan.get("plan_name", "AI Custom Plan"))
            st.write(last_plan.get("rationale", ""))
            if last_plan.get("weekly_focus"):
                st.write("**Weekly focus:** " + ", ".join(last_plan.get("weekly_focus", [])))

    st.subheader("Saved Physique Ratings")
    ratings = load_physique_ratings()
    if ratings.empty:
        st.info("No physique ratings saved yet.")
    else:
        st.dataframe(ratings.sort_values("date", ascending=False), width="stretch")

    st.subheader("Current Custom Workout Plan")
    plan_df = load_custom_plan()
    if plan_df.empty:
        st.info("No custom plan generated yet.")
    else:
        st.dataframe(plan_df, width="stretch")
