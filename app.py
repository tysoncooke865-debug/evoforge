import pandas as pd
import streamlit as st

from config.constants import APP_TITLE
from domain.workouts import load_log
from ui.nav import ALL_PAGES, resolve_page_from_state, route_button, render_sidebar_navigation, render_mobile_navigation
from ui.styles import load_app_styles
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

st.markdown("""
<div class="nw-hero">
    <div class="nw-hero-title">⚡ EVOFORGE</div>
    <div class="nw-hero-sub">Body-to-build progression</div>
    <span class="nw-badge">Forge • Quests • Class • Ascension</span>
    <div class="nw-scanline"></div>
</div>
""", unsafe_allow_html=True)

if "active_page" not in st.session_state or st.session_state.active_page not in ALL_PAGES:
    st.session_state.active_page = "Home"

PERFORMANCE_MODE = st.sidebar.toggle(
    "Performance mode",
    value=True,
    help="Keeps the glow style but reduces the heaviest animations/database refresh lag."
)

page = resolve_page_from_state()

try:
    df = load_log()
except Exception:
    df = pd.DataFrame()

if df is None:
    df = pd.DataFrame()

render_sidebar_navigation(page)
render_mobile_navigation(page)

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
