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
- **`npm ci` in `client/` BEFORE the checks, in any fresh checkout — and a
  `git worktree` is one.** `node_modules` is gitignored, so a worktree starts
  with none, and the checks below then fail three ways that each read like a
  code defect rather than a missing install: `npx tsc` → *"use npm install
  typescript"*, `npm test` → *"'vitest' is not recognized"*, `npx expo lint` →
  a `Module.require` stack. Symptom table in HANDOVER §5; this has already
  cost one work order two attempts, which is why the three npm-run checks
  below now install for themselves via `scripts/ensure-deps.mjs` — you should
  never see those messages again, but recognise them if you do.
- Checks (run from `client/`, all must pass before commit):
  `npm run typecheck` · `npm run lint` · `npm test` (vitest) ·
  `node scripts/verify-motion.mjs` · `node scripts/verify-tokens.mjs`.
  **Prefer these over `npx tsc --noEmit` / `npx expo lint`**: the `npm run`
  forms carry the `pre*` install guard, the bare `npx` forms cannot.
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
