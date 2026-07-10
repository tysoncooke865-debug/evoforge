"""First-run wizard: three steps between sign-up and the Home page.

Gated on `load_profile()` being empty — no new table and no new column. A user
who has saved a profile has been onboarded, by definition.

Nothing here computes anything. Every number comes from the existing domain
functions, so the level the wizard shows is the same level the app will show.
"""

from datetime import date, datetime

import streamlit as st

from domain.avatar_stats import calculate_avatar_stats
from domain.bodyweight import save_bodyweight_row
from domain.profile import calculate_starting_level, load_profile, rank_name, save_profile
from domain.targets import save_or_update_target
from ui.avatar_cards import render_avatar_image_panel
from ui.nav import route_to

STEP_KEY = "_onboarding_step"
TOTAL_STEPS = 3


def is_onboarded():
    """A saved profile row IS the onboarded flag.

    Deliberately not a new column: `profile` is read on nearly every page and
    the read is already cached, so this costs nothing extra.
    """
    return not load_profile().empty


def should_render():
    """Whether app.py should show the wizard instead of the router.

    Step 1 writes the profile, so `is_onboarded()` flips to True the moment it
    completes. On its own that would eject the user to Home and they would never
    see steps 2 and 3. An in-progress step therefore keeps the wizard on screen;
    step 3 clears it.
    """
    if st.session_state.get(STEP_KEY):
        return True
    return not is_onboarded()


def _step():
    return int(st.session_state.get(STEP_KEY, 1))


def _goto(step):
    st.session_state[STEP_KEY] = step
    st.rerun()


def _progress_rail(step):
    dots = "".join(
        f'<div class="ef-onb-dot {"is-done" if i < step else ""} {"is-active" if i == step else ""}"></div>'
        for i in range(1, TOTAL_STEPS + 1)
    )
    st.markdown(
        f"""
        <div class="ef-onb-header">
            <div class="ef-onb-kicker">CHARACTER CREATION · STEP {step} OF {TOTAL_STEPS}</div>
            <div class="ef-onb-rail">{dots}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _step_one():
    st.subheader("Your starting stats")
    st.caption(
        "EvoForge does not start you at Level 1. Your character begins where your "
        "real training has already taken you."
    )

    c1, c2 = st.columns(2)
    with c1:
        height_cm = st.number_input("Height cm", min_value=100.0, max_value=230.0, step=0.5, value=175.0)
        bodyweight_kg = st.number_input("Bodyweight kg", min_value=30.0, max_value=200.0, step=0.1, value=75.0)
        bench_e1rm = st.number_input("Bench 1RM kg", min_value=0.0, max_value=250.0, step=2.5, value=60.0,
                                     help="Your best single, or an honest estimate. 0 if you have never benched.")
    with c2:
        squat_e1rm = st.number_input("Squat 1RM kg", min_value=0.0, max_value=350.0, step=2.5, value=80.0)
        training_years = st.number_input("Training years", min_value=0.0, max_value=30.0, step=0.5, value=1.0)
        physique_score = st.slider("Physique score", 0, 15, 5, help="0 beginner, 10 clearly trained, 15 very aesthetic")
        leanness_score = st.slider("Leanness score", 0, 15, 5, help="0 soft, 10 lean/visible abs, 15 very lean")

    preview = calculate_starting_level(bench_e1rm, squat_e1rm, training_years, physique_score, leanness_score)
    st.metric("Your starting level", f"Level {preview} — {rank_name(preview)}")

    if st.button("Continue", type="primary", width="stretch"):
        save_profile(
            height_cm, bodyweight_kg, bench_e1rm, squat_e1rm,
            training_years, physique_score, leanness_score,
        )
        # The first bodyweight entry seeds the Progress and Body Fat pages.
        save_bodyweight_row({
            "date": str(date.today()),
            "bodyweight": float(bodyweight_kg),
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        })
        _goto(2)


def _step_two():
    st.subheader("Pick your first target")
    st.caption("One goal to aim at. You can change it, or add more, on the Goals page.")

    kind = st.radio(
        "What are you chasing?",
        ["Body fat %", "Bodyweight"],
        horizontal=True,
        captions=["Get leaner", "Gain or lose scale weight"],
    )

    if kind == "Body fat %":
        value = st.number_input("Target body fat %", min_value=4.0, max_value=40.0, step=0.5, value=12.0)
        target_type, name, unit, note = "Body Fat", "Body Fat %", "%", "Target body fat percentage"
    else:
        value = st.number_input("Target bodyweight kg", min_value=35.0, max_value=200.0, step=0.5, value=80.0)
        target_type, name, unit, note = "Bodyweight", "Bodyweight", "kg", "Target scale weight"

    c1, c2 = st.columns([1, 1])
    with c1:
        if st.button("Back", width="stretch"):
            _goto(1)
    with c2:
        if st.button("Continue", type="primary", width="stretch"):
            save_or_update_target(target_type, name, float(value), unit, note)
            _goto(3)


def _step_three():
    stats = calculate_avatar_stats()

    st.subheader("Meet your character")
    st.caption("This is what your real lifts have already earned. Train, and it evolves.")

    render_avatar_image_panel(stats)

    if st.button("Enter EvoForge", type="primary", width="stretch"):
        st.session_state.pop(STEP_KEY, None)
        st.session_state.just_saved_message = "CHARACTER FORGED"
        route_to("Home")


def render():
    step = min(max(_step(), 1), TOTAL_STEPS)
    _progress_rail(step)

    if step == 1:
        _step_one()
    elif step == 2:
        _step_two()
    else:
        _step_three()
