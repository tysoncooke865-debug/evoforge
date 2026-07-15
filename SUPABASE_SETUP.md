# Supabase setup — the pending changes, step by step

> **✅ ALL THREE STEPS EXECUTED 2026-07-15** (Claude session, management token +
> repo credential). Each check below was run for real: migration 020 read back;
> `ai-plan-scan` OPTIONS 200 + a live OpenAI transcription round-trip;
> `SUPABASE_ACCESS_TOKEN` secret set and the CI step merged into `client.yml`.
> **Falsification found a bug**: 007's `ai_scan_cache.kind` check rejected
> `'plan-scan'` — cache and hourly rate limit were silently dead for scans
> (`storeCache` is best-effort). Fixed by **migration 021** (applied). The
> `nutrition` branch's migration therefore renumbers to **022**, not 021.
> Kept for the procedure/checks; nothing here is pending anymore.

> For whoever holds dashboard/CLI access. Everything in the app code is already
> merged and live; these are the server-side steps the code is waiting on.
> Each step ends with a check so you know it worked. ~15 minutes total.
> Written 2026-07-15 (branch `expo-rewrite`, commit `770c3fe`).

**Project:** `rysbpwpvnqbngqncrfaa` (the production Supabase project — the one
whose URL is in the app's env). You need to be a member of it, or have the
owner run these while you read.

---

## 1. Apply migration 020 — unlocks the KG⇄LB toggle  (~2 min)

The per-exercise pounds toggle is live in the app but shows **"UNIT NOT SAVED"**
until this column exists.

1. Supabase Dashboard → SQL Editor → New query.
2. Paste the entire contents of **`migrations/020_weight_unit_pref.sql`** (repo
   root → `migrations/`). It is one additive `ALTER TABLE` — idempotent, safe to
   re-run, touches no data.
3. Run.

**Check it worked:**
```sql
select column_name, column_default
from information_schema.columns
where table_name = 'user_exercise_prefs' and column_name = 'weight_unit';
```
→ one row, default `'kg'`. In the app: open any exercise card on Train, tap the
`WEIGHT · KG ⇄` header — it should flip to LB **and stay flipped after a reload**.

> Do NOT apply `migrations/020_nutrition.sql` if you see it on the `nutrition`
> branch — that file must be **renumbered to 021** before it is ever run
> (mainline claimed 020). It belongs to an unmerged parallel feature; skip it
> entirely unless you are merging that branch.

---

## 2. Deploy the `ai-plan-scan` edge function — unlocks PLAN SCAN  (~5 min)

The "scan a written workout" feature is live in the app but its server half was
never deployed — the app currently shows *"AI functions are not deployed yet"*.

From any machine (needs Node or Homebrew for the CLI):

```bash
# install the Supabase CLI if you don't have it
npm install -g supabase        # or: brew install supabase/tap/supabase

# log in (opens a browser; or paste an access token from
# https://supabase.com/dashboard/account/tokens)
supabase login

# from the repo root, on branch expo-rewrite:
supabase functions deploy ai-plan-scan --project-ref rysbpwpvnqbngqncrfaa
```

The function needs `OPENAI_API_KEY` set as a **function secret** — it almost
certainly already is (ai-plan / ai-physique / ai-bodyfat use the same one).
Verify under Dashboard → Edge Functions → Secrets; if missing:
```bash
supabase secrets set OPENAI_API_KEY=<the key> --project-ref rysbpwpvnqbngqncrfaa
```

**Check it worked:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/ai-plan-scan
```
→ `200` (it is `404` today). Then in the app: Train → BUILD/EDIT MY PLAN →
**📷 SCAN A WRITTEN WORKOUT** → photograph any handwritten workout → exercises
should appear in the builder. This is the first real end-to-end test of the
OpenAI leg — everything around it is already verified.

---

## 3. (Recommended) Make function deploys automatic forever  (~5 min)

So no function ever sits committed-but-undeployed again:

1. Create an access token: https://supabase.com/dashboard/account/tokens
2. GitHub repo → Settings → Secrets and variables → Actions →
   **New repository secret**: name `SUPABASE_ACCESS_TOKEN`, value = the token
   (paste it bare — no quotes).
3. Add the parked CI step: open **`tools/ci/supabase-functions-deploy.step.yml`**
   and paste its step block (everything below the comment header) at the **end
   of the `deploy` job** in `.github/workflows/client.yml`. Easiest via the
   GitHub web editor — note that pushing workflow files from a local machine
   needs a token with the `workflow` OAuth scope (`gh auth refresh -s workflow`).

**Check it worked:** the next push to `expo-rewrite` shows a
`Deploy edge functions` step in the Actions run summary listing
`deployed: ai-plan-scan` (and the others).

---

## Already done — do NOT redo

- Migrations **001–019** are applied. `xp_events` (002/003/006), `public_profile`
  (004), leaderboard (005), battle arena (009–011), `workout_schedule` (012),
  coins (013–015), `user_exercises`+`routines` (016), `workout_sessions` (017),
  `user_plans` (018), `user_exercise_prefs` (019).
- All other edge functions (`ai-plan`, `ai-physique`, `ai-bodyfat`, `battle-*`)
  are deployed and answering.
- RLS is on everywhere with owner-only policies; never add `service_role` keys
  to anything client-side, and never put a secret key in `EXPO_PUBLIC_*`.

## If something looks wrong

- The app **degrades gracefully** on every one of these gaps (honest toasts, no
  crashes), so a mistake here can't take the app down — worst case a feature
  stays in its "not set up yet" state.
- The repo doctrine for verifying: don't trust a green message — do the check
  listed under each step, in the real app, and read the row back.
