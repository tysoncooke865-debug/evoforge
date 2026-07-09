import streamlit as st

from config.constants import APP_TITLE
from ui.nav import ALL_PAGES, resolve_page_from_state, route_button, render_sidebar_navigation, render_mobile_navigation
from ui.styles import load_app_styles
from ui.components import ui_toast_area
from ui.avatar_cards import render_workout_xp_toast
import pages.routine as pages_routine
import pages.profile as pages_profile
import pages.measurements as pages_measurements
import pages.bodyweight as pages_bodyweight
import pages.goals as pages_goals
import pages.achievements as pages_achievements
import pages.delete_data as pages_delete_data
import pages.data_manager as pages_data_manager
import pages.cardio as pages_cardio
import pages.avatar as pages_avatar
import pages.progress as pages_progress
import pages.physique as pages_physique
import pages.today as pages_today
import pages.bodyfat as pages_bodyfat
import pages.home as pages_home

PAGE_RENDERERS = {
    "Home": pages_home.render,
    "Profile": pages_profile.render,
    "Measurements": pages_measurements.render,
    "Physique": pages_physique.render,
    "Today": pages_today.render,
    "Cardio": pages_cardio.render,
    "Avatar": pages_avatar.render,
    "Progress": pages_progress.render,
    "Goals": pages_goals.render,
    "Achievements": pages_achievements.render,
    "Body Fat": pages_bodyfat.render,
    "Bodyweight": pages_bodyweight.render,
    "Data Manager": pages_data_manager.render,
    "Delete Data": pages_delete_data.render,
    "Routine": pages_routine.render,
}

# "auto" keeps the sidebar open on desktop and collapsed on phones, so the
# mobile brand bar is never competing with an open nav panel.
st.set_page_config(page_title=APP_TITLE, layout="wide", initial_sidebar_state="auto")
load_app_styles()

if "active_page" not in st.session_state or st.session_state.active_page not in ALL_PAGES:
    st.session_state.active_page = "Home"

PERFORMANCE_MODE = st.sidebar.toggle(
    "Performance mode",
    value=False,
    help="Reduces the heaviest ambient animations. The neon styling stays.",
)

# Streamlit exposes no <body> hook, so drop a sentinel the stylesheet can key
# off with :has(). Must be a single balanced markdown call.
if PERFORMANCE_MODE:
    st.markdown('<div class="ef-perf-mode" aria-hidden="true"></div>', unsafe_allow_html=True)

page = resolve_page_from_state()

render_sidebar_navigation(page)
render_mobile_navigation(page)

# Both toast systems must be pumped every run, or the messages that pages set
# in session_state are written and never read.
#   ui_toast_area()          -> just_saved_message / pr_message / achievement_message
#   render_workout_xp_toast() -> show_xp_toast, set by mark_xp_gain() on set save
ui_toast_area()
render_workout_xp_toast()

renderer = PAGE_RENDERERS.get(page, pages_home.render)
renderer()

if page != "Home":
    st.markdown('<div class="ef-back-sep"></div>', unsafe_allow_html=True)
    route_button("← Back to Base", "Home", key=f"back_to_base_{page}")
