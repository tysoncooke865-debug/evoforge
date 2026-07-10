"""Escape anything that reaches `unsafe_allow_html`.

This app builds whole cards as one HTML string and hands them to `st.markdown(...,
unsafe_allow_html=True)`, because a `<div>` split across two markdown calls does not
nest. That is the right call for layout. It also means every value interpolated into
one of those f-strings is injected into the DOM verbatim.

WHERE THE UNTRUSTED TEXT COMES FROM
  * OpenAI. `custom_workout_plan.exercise` and `.reps` are model output stored in the
    database and rendered on Missions. `stats["weak_point_focus"]` is overwritten
    with model output by `views/avatar.py` after an AI run.
  * The athlete. Their email address, rendered in the sidebar -- inside a `title="..."`
    attribute, where a stray quote escapes the attribute rather than the element.

WHY IT MATTERS MORE THAN IT USED TO
  Today an injection here is defacement, and under RLS it is mostly self-inflicted.
  The moment a persistent auth cookie exists it becomes account takeover: Streamlit
  components cannot set `HttpOnly`, so any script running on this page can read the
  refresh token. This module lands BEFORE that cookie, on purpose.

Constants from `config/constants.py` -- ACHIEVEMENTS, ROUTINE, MUSCLE_MAP, rank and
evolution names -- are developer-controlled and need no escaping. Escaping them is
harmless; forgetting to escape the other kind is not.
"""
import html


def esc(value):
    """HTML-escape a value for interpolation into markup, attributes included.

    `quote=True` also escapes `"` and `'`, which is what makes it safe inside
    `title="{...}"`. Without it, `" onmouseover=alert(1) x="` breaks straight out of
    the attribute.

    None becomes an empty string rather than the text "None".
    """
    if value is None:
        return ""
    return html.escape(str(value), quote=True)
