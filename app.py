import streamlit as st

from auth.persistence import render_restoring_placeholder, restore_session
from auth.session import is_signed_in
from config.constants import APP_TITLE
from ui.nav import (
    ALL_PAGES, resolve_page_from_state, route_button, render_sidebar_account,
    render_sidebar_navigation, render_mobile_navigation,
)
from ui.styles import load_app_styles
from ui.components import ui_toast_area
from ui.avatar_cards import render_workout_xp_toast
import views.auth as view_auth
import views.onboarding as view_onboarding
import views.routine as view_routine
import views.profile as view_profile
import views.measurements as view_measurements
import views.bodyweight as view_bodyweight
import views.goals as view_goals
import views.achievements as view_achievements
import views.delete_data as view_delete_data
import views.data_manager as view_data_manager
import views.cardio as view_cardio
import views.avatar as view_avatar
import views.progress as view_progress
import views.physique as view_physique
import views.today as view_today
import views.bodyfat as view_bodyfat
import views.home as view_home
import views.leaderboard as view_leaderboard

PAGE_RENDERERS = {
    "Home": view_home.render,
    "Profile": view_profile.render,
    "Measurements": view_measurements.render,
    "Physique": view_physique.render,
    "Today": view_today.render,
    "Cardio": view_cardio.render,
    "Avatar": view_avatar.render,
    "Progress": view_progress.render,
    "Goals": view_goals.render,
    "Leaderboard": view_leaderboard.render,
    "Achievements": view_achievements.render,
    "Body Fat": view_bodyfat.render,
    "Bodyweight": view_bodyweight.render,
    "Data Manager": view_data_manager.render,
    "Delete Data": view_delete_data.render,
    "Routine": view_routine.render,
}

# "auto" keeps the sidebar open on desktop and collapsed on phones, so the
# mobile brand bar is never competing with an open nav panel.
st.set_page_config(page_title=APP_TITLE, layout="wide", initial_sidebar_state="auto")
load_app_styles()

# ------------------------------------------------------ restore the session
# Must run BEFORE the gate consults is_signed_in(). `st.context.cookies` is
# read-only, so a cookie component writes the Supabase refresh token and this
# exchanges it for a fresh session on each new browser connection.
#
# It returns True for the run or two while the component's iframe reports back --
# `get_all()` is empty until then, and showing the login screen in that window
# would flash "signed out" at somebody who is signed in.
#
# Every failure path leaves `_auth_user` unset, so the gate below renders the login
# screen exactly as it does today. Persistence can never make things worse.
if restore_session():
    render_restoring_placeholder()
    st.stop()

# ---------------------------------------------------------------- auth gate
# Nothing below this runs for a signed-out visitor. The sidebar is not rendered
# either: it would leak the previous session's avatar, level and XP.
if not is_signed_in():
    ui_toast_area()
    view_auth.render()
    st.stop()

# ------------------------------------------------------------ onboarding gate
# "Has a profile row" IS the onboarded flag. No extra table, no extra column.
if view_onboarding.should_render():
    ui_toast_area()
    view_onboarding.render()
    st.stop()

if "active_page" not in st.session_state or st.session_state.active_page not in ALL_PAGES:
    st.session_state.active_page = "Home"

page = resolve_page_from_state()

render_sidebar_navigation(page)

# Sidebar widgets render in call order, so this must come after the nav to sit
# beneath it rather than above the brand.
st.sidebar.markdown('<div class="ef-side-nav-title">SETTINGS</div>', unsafe_allow_html=True)
PERFORMANCE_MODE = st.sidebar.toggle(
    "Performance mode",
    value=False,
    help="Reduces the heaviest ambient animations. The neon styling stays.",
)

# Streamlit exposes no <body> hook, so drop a sentinel the stylesheet can key
# off with :has(). Must be a single balanced markdown call.
if PERFORMANCE_MODE:
    st.markdown('<div class="ef-perf-mode" aria-hidden="true"></div>', unsafe_allow_html=True)

# Last in the sidebar, so identity sits beneath navigation and settings.
render_sidebar_account()

render_mobile_navigation(page)

# Both toast systems must be pumped every run, or the messages that pages set
# in session_state are written and never read.
#   ui_toast_area()          -> just_saved_message / pr_message / achievement_message
#   render_workout_xp_toast() -> show_xp_toast, set by mark_xp_gain() on set save
ui_toast_area()
render_workout_xp_toast()

renderer = PAGE_RENDERERS.get(page, view_home.render)
renderer()

if page != "Home":
    st.markdown('<div class="ef-back-sep"></div>', unsafe_allow_html=True)
    route_button("← Back to Base", "Home", key=f"back_to_base_{page}")
