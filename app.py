import streamlit as st

from config.constants import APP_TITLE
from ui.nav import ALL_PAGES, resolve_page_from_state, route_button, render_sidebar_navigation, render_mobile_navigation
from ui.styles import load_app_styles
from ui.components import ui_toast_area
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

st.set_page_config(page_title=APP_TITLE, layout="wide")
load_app_styles()

if "active_page" not in st.session_state or st.session_state.active_page not in ALL_PAGES:
    st.session_state.active_page = "Home"

PERFORMANCE_MODE = st.sidebar.toggle(
    "Performance mode",
    value=True,
    help="Keeps the glow style but reduces the heaviest animations."
)

# Tag the DOM so CSS can gate heavy animation on .perf-mode.
# Streamlit gives us no body hook, so mark a sentinel element and let the
# stylesheet key off :has(). Kept as one balanced markdown call.
if PERFORMANCE_MODE:
    st.markdown('<div class="ef-perf-mode" data-perf-mode="1"></div>', unsafe_allow_html=True)

page = resolve_page_from_state()

render_sidebar_navigation(page)
render_mobile_navigation(page)

# Surfaces just_saved_message / pr_message / achievement_message, which pages
# set on save. Without this call those toasts are silently swallowed.
ui_toast_area()

if page == "Home":
    pages_home.render()
elif page == "Profile":
    pages_profile.render()
elif page == "Measurements":
    pages_measurements.render()
elif page == "Physique":
    pages_physique.render()
elif page == "Today":
    pages_today.render()
elif page == "Cardio":
    pages_cardio.render()
elif page == "Avatar":
    pages_avatar.render()
elif page == "Progress":
    pages_progress.render()
elif page == "Goals":
    pages_goals.render()
elif page == "Achievements":
    pages_achievements.render()
elif page == "Body Fat":
    pages_bodyfat.render()
elif page == "Bodyweight":
    pages_bodyweight.render()
elif page == "Data Manager":
    pages_data_manager.render()
elif page == "Delete Data":
    pages_delete_data.render()
elif page == "Routine":
    pages_routine.render()

if page != "Home":
    st.markdown("---")
    route_button("← Back to Base", "Home", key=f"back_to_base_{page}")
