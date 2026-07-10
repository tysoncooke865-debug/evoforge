"""The public leaderboard.

Reads `domain/public_profile.py :: leaderboard_top()`, which returns FOUR columns
and never body data. Every `display_name` is attacker-controlled text rendered on
other athletes' screens, and the auth cookie is JS-readable, so every name goes
through `ui/escape.py :: esc()`. `tools/verify_escape.py` and `tools/verify_leaderboard.py`
both guard that.

Correct on both sides of migrations/005: before it is applied the RPC errors,
`leaderboard_top()` returns `[]`, and this shows a "warming up" state.
"""
import streamlit as st

from domain.public_profile import get_public_identity, leaderboard_top
from domain.profile import rank_name
from domain.workouts import load_log, workout_summary
from domain.xp import level_and_progress
from ui.components import page_hero
from ui.escape import esc
from ui.nav import route_button


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def render():
    page_hero("Leaderboard", "Real training, ranked. Opt in from your Profile to appear.", "Ranked")

    lqa1, lqa2 = st.columns(2)
    with lqa1:
        route_button("Edit your public profile →", "Profile", key="qol_leaderboard_profile")
    with lqa2:
        route_button("Log a workout →", "Today", key="qol_leaderboard_today")

    # If the signed-in athlete is mid-reconciliation, the SQL hides them (drift != 0).
    # Say so, rather than let them wonder why they are missing.
    summary = workout_summary(load_log())
    if summary.get("xp_drift", 0) != 0:
        st.warning(
            "Your XP is reconciling, so you are temporarily hidden from the board. "
            "It clears on its own once the ledger catches up."
        )

    name, is_public = get_public_identity()
    if not name or not is_public:
        st.info("You are not on the leaderboard yet. Set a display name and turn on "
                "“Show me on the leaderboard” in your Profile.")

    rows = leaderboard_top(50)
    if not rows:
        st.caption("The leaderboard is warming up — no ranked athletes yet. "
                   "Be the first: opt in from your Profile.")
        return

    # RANK BY AVATAR LEVEL, not raw XP. The level shown in each row is
    # level_and_progress(base_level, xp), and two athletes with the same XP but
    # different base levels sit at different levels -- so XP order and level order
    # can disagree, and the board must follow the level. The curve lives in
    # domain/xp.py; rank here rather than duplicate it into the SQL function. XP is
    # the tiebreak within a level (more progress ranks higher), then name.
    ranked = []
    for row in rows:
        xp = _safe_int(row.get("xp"))
        base_level = _safe_int(row.get("base_level"), 1)
        level = level_and_progress(base_level, xp)[0]
        ranked.append((level, xp, str(row.get("display_name") or ""), row))
    ranked.sort(key=lambda t: (-t[0], -t[1], t[2]))

    # Build the whole table as ONE balanced markdown string. A <div> split across two
    # st.markdown calls does not nest. Every interpolated value is escaped: the names
    # are user-supplied, and even the numbers go through esc() as defence in depth.
    body_rows = []
    for position, (level, xp, _name, row) in enumerate(ranked, start=1):
        display = esc(row.get("display_name"))
        rank = esc(rank_name(level))
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(position, "")
        body_rows.append(
            f'<div class="lb-row">'
            f'<span class="lb-pos">{medal or f"#{esc(position)}"}</span>'
            f'<span class="lb-name">{display}</span>'
            f'<span class="lb-rank">{rank}</span>'
            f'<span class="lb-level">Lv {esc(level)}</span>'
            f'<span class="lb-xp">{esc(xp)} XP</span>'
            f"</div>"
        )

    st.markdown(
        f'<div class="lb-board">{"".join(body_rows)}</div>',
        unsafe_allow_html=True,
    )
