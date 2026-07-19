# EvoForge — project memory

> **THE PRODUCT is the Expo client in `client/` on branch `expo-rewrite`**
> (auto-deploys to https://expo-rewrite.evoforge.pages.dev). Read
> `HANDOVER.md` at the repo root and work there.
>
> **The Python/Streamlit app was retired (Tyson, 2026-07-16) and DELETED
> from this branch (2026-07-19)** along with its CI (`verify.yml`), its 13
> verify scripts, `views/`, `services/`, `.streamlit/`, `app.py` and its
> test art. `main` keeps the full history. What remains of the Python side
> is LOAD-BEARING for the client and must not be treated as dead:

## The surviving Python contract
- **`domain/*.py` + `config/constants.py` are the goldens contract.**
  `tools/gen_fixtures.py --check` (run by `client.yml` on every push)
  regenerates `contracts/fixtures/` from them and fails CI on drift — they
  are the arbiter of the client's ported math (XP curve, avatar stats,
  summary shaping, catalogs). Change the Python FIRST, regenerate, then
  re-port. The import chain keeps root `data/`, `auth/`, `ui/` alive
  (module imports only — nothing executes Streamlit).
- **`assets/styles.css`** is parity-checked by
  `client/scripts/verify-tokens.mjs` (tokens.js ⟷ :root). Retiring that
  parity is a deliberate guard change, not a cleanup.
- **`tools/hooks/`** — the commit-msg hook enforcing `[architect]` on
  protected paths. Install once: `git config core.hooksPath tools/hooks`.

## The database contract (outlived the app that created it)
- 13 original tables + everything migrations `001`–`064` added. Every
  table is owner-only RLS (`user_id = auth.uid()`, `DEFAULT auth.uid()`).
- **Cross-user reads go through `security definer` RPCs only.**
- **`xp_events` is append-only** (owner select+insert; the 006/033 guard
  trigger recomputes amounts server-side). A set is flat 10 XP; the curve
  is `500 + (L-1)*25`; `domain/xp.py` ⟷ `client/src/domain/xp.ts` via
  goldens.
- **Never gate a SECURITY DEFINER trigger on `current_user`** — use a
  txn-local GUC (`evoforge.spend_authorized` / `evoforge.xp_authorized`)
  or service_role (the 030/033 lesson).
- Migrations are numbered `.sql` files in `migrations/`, applied by hand
  via the management API and falsified with the smoke accounts before the
  client commit that depends on them (see HANDOVER §5).
- `migrations/037` is a SHARED number (nutrition + workout_ghosts — both
  applied). `custom_workout_plan` is retired (062) — never write it.

## Session protocol
1. Read `HANDOVER.md`. Work in `client/` unless the task says otherwise.
2. The verify loop, per commit (HANDOVER §5): cold lint, tsc, vitest,
   verify-tokens / verify-battle-engine / verify-motion, `expo export`,
   then a Playwright tour against production as the smoke accounts.
3. `[architect]` in the commit message for protected paths (the hook
   lists them).
4. Update HANDOVER.md in the same commit as the change it describes.

## Docs
- `HANDOVER.md` — the live handbook (state, rules that cost real bugs).
- `ARCHITECTURE.md` · `ROADMAP.md` · `PARITY.md` · `docs/` (specs).
- `docs/archive/` — executed plan docs, kept for history.
