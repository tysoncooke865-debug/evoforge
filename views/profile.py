import streamlit as st

from domain.profile import load_profile, save_profile, calculate_starting_level, rank_name
from domain.bodyweight import latest_bodyweight_value
from domain.workouts import current_exercise_best_1rm
from domain.achievements import check_achievements
from ui.components import page_hero


def render():
    page_hero("Athlete Profile", "Set your baseline stats so levels reflect your current physique.", "Profile")
    st.info("Set your starting level from your current real-world stats, so you don't start at Level 1.")

    profile = load_profile()
    latest = profile.iloc[-1].to_dict() if not profile.empty else {}

    c1, c2 = st.columns(2)
    with c1:
        height_cm = st.number_input("Height cm", min_value=100.0, max_value=230.0, step=0.5, value=float(latest.get("height_cm", 183.5) or 183.5))
        bodyweight_kg = st.number_input("Bodyweight kg", min_value=30.0, max_value=200.0, step=0.1, value=float(latest.get("bodyweight_kg", latest_bodyweight_value() or 76.0) or 76.0))
        bench_e1rm = st.number_input("Current bench estimated 1RM kg", min_value=0.0, max_value=250.0, step=2.5, value=float(latest.get("bench_e1rm", current_exercise_best_1rm("Barbell Bench Press (Strength)") or 96.0) or 96.0))
    with c2:
        squat_e1rm = st.number_input("Current squat estimated 1RM kg", min_value=0.0, max_value=350.0, step=2.5, value=float(latest.get("squat_e1rm", current_exercise_best_1rm("Barbell Back Squat") or 140.0) or 140.0))
        training_years = st.number_input("Training years", min_value=0.0, max_value=30.0, step=0.5, value=float(latest.get("training_years", 3.0) or 3.0))
        physique_score = st.slider("Physique score", 0, 15, int(float(latest.get("physique_score", 10) or 10)), help="0 beginner, 10 clearly trained, 15 very aesthetic")
        leanness_score = st.slider("Leanness score", 0, 15, int(float(latest.get("leanness_score", 10) or 10)), help="0 soft, 10 lean/visible abs, 15 very lean")

    preview_level = calculate_starting_level(bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score)
    st.metric("Calculated Starting Level", f"Level {preview_level} — {rank_name(preview_level)}")

    if st.button("Save Athlete Profile", type="primary"):
        level = save_profile(height_cm, bodyweight_kg, bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score)
        check_achievements()
        st.session_state.just_saved_message = f"PROFILE SAVED — LEVEL {level}"
        st.rerun()

    st.subheader("Rank System")
    st.write("🌱 Level 1-9: Rookie")
    st.write("⚔️ Level 10-24: Trainee")
    st.write("🦾 Level 25-39: Athlete")
    st.write("💎 Level 40-59: Aesthetic Tier")
    st.write("⚡ Level 60-74: Elite Physique")
    st.write("🗿 Level 75-89: Chad-Lite")
    st.write("👑 Level 90-99: Chad")
    st.write("☀️ Level 100: True Adam")
