# AGENTS.md — EvoForge

Pointer file for coding agents. The canonical instructions live in:

1. **`HANDOVER.md`** (repo root, branch `expo-rewrite`) — READ FIRST. Current
   state, the rules that cost real bugs, the verification loop, what's next.
2. **`client/CLAUDE.md`** — the Expo client's project memory: stack, commands,
   doctrine, layout, operational notes.
3. **Root `CLAUDE.md`** — the retired Streamlit app's memory; its `domain/`
   goldens remain the pinned correctness contract for `client/src/domain/`.
4. **`docs/`** — feature program specs (e.g. `ORIGIN_*.md`;
   `ORIGIN_HANDOFF_AUDIT.md` tracks the Origin onboarding takeover).

## Quick reference

- Product = Expo client in `client/` on branch `expo-rewrite`, auto-deploys
  to https://expo-rewrite.evoforge.pages.dev. Streamlit on `main` is retired.
- Checks (run from `client/`, all must pass before commit):
  `npx tsc --noEmit` · `npx expo lint` · `npm test` (vitest) ·
  `node scripts/verify-motion.mjs` · `node scripts/verify-tokens.mjs`.
- Migrations in `migrations/` are applied via the Supabase management API
  (see HANDOVER.md); never edit an already-deployed migration file — add a
  corrective one. Highest applied: 046 (022 absent, 037 duplicated:
  pre-existing quirks).
- Protected paths (`migrations/`, `data/`, auth, XP contracts…) require
  `[architect]` in the commit message; hooks:
  `git config core.hooksPath tools/hooks`.
- `git pull --rebase` before pushing — multiple agent sessions work this repo.
- Every new guard/test must be falsified once (break it, watch it go red,
  restore) before it is trusted.
