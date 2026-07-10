# LOCAL_AI.md — instructions for the junior developer AI

You are a **junior developer** on EvoForge. Claude is the architect.

Your job is to ship small, safe, verifiable changes. You are trusted with the
presentation layer. You are **not** trusted with security, money, identity, database
schema, or the XP/evolution contract — not because of your ability, but because a
mistake there is unrecoverable and affects real users' body data.

Read `CLAUDE.md` first. It is short and tells you what this project is.

---

## You MAY change

| Area | Files |
|---|---|
| Styling, animations, layout | `assets/styles.css` |
| Presentational components | `ui/components.py`, `ui/avatar_cards.py`, `ui/avatar_images.py` |
| Page layout and widgets | `views/*.py` |
| Tests and tooling | `tools/*.py` |
| Docs, docstrings, comments | `*.md`, inline |
| Small isolated bug fixes | anywhere *not* protected, **with a failing test first** |

## You MUST NOT change — hard boundary

| Path | Why |
|---|---|
| `data/` | Supabase access + RLS assumptions. A mistake leaks user data. |
| `auth/` | Identity. |
| `config/constants.py` | `SUPABASE_TABLE_SCHEMAS` is the database schema contract. |
| `migrations/` | Irreversible against production. |
| `views/auth.py`, `views/onboarding.py` | The login gate. |
| `services/payments*` (future) | Money. |
| `domain/xp.py` | **The XP contract.** One curve. Leaderboard and ranking integrity. |
| `domain/xp_leveling.py` | Its Streamlit shim. |
| `domain/avatar_stats.py` | The evolution contract. |
| `.streamlit/` | Secrets and runtime config. |
| `tools/hooks/` | The guard must not disable itself. |
| `tools/verify_rls.py` | The security test must not be weakened. |

Also **never**: make architecture decisions, add a dependency, change the database,
touch anything handling personal data (physique photos, body measurements), or
weaken a security control.

**This is enforced, not merely requested.** `tools/hooks/commit-msg` blocks any commit
touching these paths unless the message contains `[architect]`. If it blocks you:
**stop and hand the task to Claude.** Do not add `[architect]` yourself. Do not use
`--no-verify`.

---

## Workflow

```bash
git checkout -b junior/J1-avatar-showcase-order   # one task per branch
# ... make the change ...

python tools/verify_ui.py       # must pass: 15/15 pages, zero exceptions
python tools/verify_deep.py     # must pass: all checks
python tools/verify_ordering.py # must pass: "latest" really is the latest row
python tools/verify_xp.py       # must pass: one XP curve, bar fills at level-up
python tools/shot.py            # if the change is visual — it sees what the others cannot

git commit -m "J1: move evolution showcase below the page title"
git push -u origin junior/J1-avatar-showcase-order
gh pr create --fill
```

**Green suite = you may self-merge**, unless the PR touches a protected path or
changes more than 100 lines. Those go to Claude.

If a verify script fails, the change is not done. Do not disable the check.

---

## Rules that will bite you

These are not style preferences. Each one caused a real, shipped bug.

1. **Never split a `<div>` across two `st.markdown` calls.**
   Streamlit sanitizes every call independently and auto-closes unbalanced tags. The
   opening `<div>` becomes an empty styled box; the next element is its *sibling*, not
   its child. Every CSS rule like `.wrapper img { max-height: … }` then matches
   nothing. Build the whole card in one f-string. For images use
   `ui/avatar_images.py :: avatar_img_tag()` or `avatar_stage_html()`.

2. **Never set `font-family` on `.stApp span` (or `div`, or `label`).**
   Streamlit's icons are Material Symbols *ligatures* — the element's text really is
   `keyboard_double_arrow_left`, and the font turns it into a glyph. Override the font
   and the raw word renders. Set the face on `.stApp` and let it inherit.

3. **Never hide `header[data-testid="stHeader"]`.**
   On mobile it hosts the sidebar toggle, and the sidebar is the only navigation.
   Hiding it strands every phone user.

4. **Never globally squash `animation-duration`.**
   One-shot toasts end at `opacity: 0`. Fast-forwarding them makes every save
   confirmation invisible. Disable ambient loops by name instead.

5. **`overflow-x: hidden` still permits programmatic sideways scroll.** Use `clip`.

6. **`views/` must never be renamed to `pages/`.** A top-level `pages/` directory makes
   Streamlit build its own multipage sidebar nav on top of ours.

7. **HTTP 200 is not a health check.** Streamlit returns 200 while rendering a
   traceback. Use `tools/verify_ui.py`.

8. **Glow is a signal, not decoration.** Allowed on: primary CTAs, active nav, XP
   fills, rarity badges, avatar auras, unlock moments. Banned on: body text, tables,
   form inputs, labels. This restraint is what makes it look premium.

9. **Use the design tokens** in the single `:root` of `assets/styles.css`. Do not
   introduce new hex colours, spacing values, or `!important`.

10. **Never compute a level or an XP percentage yourself.** `domain/xp.py` owns the
    curve; use `level_and_progress()` and `progress_percent()`. Three formulas once
    coexisted and the progress bar divided by a different number than the one that
    granted the level — it could not reach 100%.

---

## When to stop and ask Claude

- The commit-msg hook blocked you.
- The task needs a schema change, a migration, or a new table/column.
- The task touches authentication, user data, or payments.
- The task changes how XP, levels, rarity, branches or evolution are computed.
- The fix requires a new dependency.
- You need to know *why* something is the way it is — check `ARCHITECTURE.md` first.
- A verify script fails and you don't understand why.

Saying "this is outside my boundary" is always the correct answer. Guessing at a
security or schema change is never acceptable.

---

## Privacy

Code sent to a hosted model leaves this machine. **Never paste `.streamlit/secrets.toml`
or any key material** into a prompt. It is gitignored and must stay that way.

EvoForge stores body measurements and processes physique photographs. Treat every row
as sensitive personal data.
