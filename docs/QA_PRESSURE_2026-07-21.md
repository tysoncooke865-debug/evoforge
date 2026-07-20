# Pressure test — 2026-07-21

Smoke-account debug + pressure pass over every route and the journeys a NEW
athlete actually walks. Driven by Playwright against a local `expo export`
build talking to the production Supabase project.

Scripts (session scratchpad): `pressure.mjs` (route sweep), `journeys.mjs`
(new-user journeys + stress), `deep.mjs` (search accuracy, reset, workout, AI,
quick match), `workout.mjs` / `modal.mjs` (targeted follow-ups).

## Result

- **30/30 routes render.** No blank screens, no navigation crashes.
- **Journeys: 13/13** after fixes (12/13 before).
- **Deep flows: 8/8**, zero console or network errors.
- Rapid tab-hammering (15 navigations, each interrupted mid-load) threw **no**
  exceptions. Offline still renders. Sign-out returns to auth cleanly.

## Bugs found and FIXED

### 1. Every app boot lost its `session_start` and `last_login_at` (HIGH)
`useAnalytics()` mounted in the authed layout and fired immediately, but
supabase-js restores the session asynchronously — so the first
`analytics_events` insert and `touch_activity` call went out unauthenticated
and were rejected:

```
401 POST /rest/v1/analytics_events :: new row violates row-level security policy
401 POST /rest/v1/rpc/touch_activity :: touch_activity: not signed in.
```

This silently destroyed exactly the data the telemetry was built to collect
(session counts, last-login, time-on-app). **Fixed:** `useAnalytics(userId)`
now takes the session user and arms only once it exists. Verified — the 401s
are gone from a full run.

### 2. Sign-up with an existing email was an inescapable dead end (HIGH)
Supabase deliberately does **not** error on a duplicate sign-up (that would
leak which addresses are registered) — it returns a user with an empty
`identities` array and no session, which is byte-identical to a fresh sign-up.
The screen therefore showed "CHECK YOUR EMAIL" to a returning athlete, who then
waited on a mail that is never sent, with no way off that screen.

**Fixed:** detect `identities.length === 0` and say "That email already has an
account. Sign in instead — or reset your password."

### 3. Confirmation and reset links pointed at `localhost:3000` (CRITICAL)
The project's `site_url` was still the scaffold default and `uri_allow_list`
was **empty**. With email confirmation now on, every confirmation link mailed
to a real user would have been a dead localhost URL — signup would have been
completely broken for anyone but a developer.

**Fixed** via the management API:
- `site_url` → `https://expo-rewrite.evoforge.pages.dev`
- `uri_allow_list` → the two pages.dev origins + `localhost:8081` / `:4173`

### 4. There was no password reset at all (HIGH)
No `resetPasswordForEmail` anywhere in the codebase, and no "forgot password"
link. An athlete who forgot their password had no route back into their
account. Now that email is a hard gate, this was untenable.

**Built:** `src/app/(auth)/reset-password.tsx` — both halves in one screen
(request the mail; choose the new password when arriving from the link), linked
from sign-in. Two details that matter:
- The recovery link mints a **real session**, so `(auth)/_layout` would have
  redirected it to Home with the old password still in force. The layout now
  exempts `reset-password`.
- The request half always claims success, so it can't be used to enumerate
  which emails are registered. Verified against an address with no account.

### 5. The confirmation screen had no "didn't get it?" path (MEDIUM)
Added a resend button plus a spam-folder hint. Without it, a mail that fails to
land traps the user — signing up again just errors with "already registered".

## Not bugs (checked, working as designed)

- `/muscle-lab` renders ~47 chars — it is a dev-only mask workbench that
  returns `null` unless `__DEV__` or `EXPO_PUBLIC_MUSCLE_LAB=1`. Correct.
- Friend search returning nothing for `"sm"` — the only `sm*` profiles are the
  two smoke accounts, both private, correctly excluded. `"cha"` returns 4 hits
  and `"CHARLIE"` returns 2, so substring + case-insensitive matching both work.
- `start-empty` not changing the URL — QUICK WORKOUT opens a modal
  (`adhoc-name` / `adhoc-search-input` / `adhoc-start`), it does not navigate.
- `409 coin_events` on boot — the daily-grant upsert racing itself. Benign and
  already known.

## Still open

### Operational — needs Tyson
1. **Custom SMTP is not configured** (`smtp_host` is null) and
   `rate_limit_email_sent` is **2 per hour**. The shared default sender is
   explicitly not for production and lands in spam often. Because of this,
   **email confirmation was turned back OFF** (`mailer_autoconfirm: true`,
   Tyson 2026-07-21) as a stopgap — new signups are auto-confirmed and get a
   session immediately, so signup is not blocked on mail delivery. The client
   still handles the confirmation flow, so re-enabling it is a one-flag change
   once SMTP is set up. **Password reset mail still depends on this sender**
   regardless. Configure SMTP (Resend/Postmark/SES) on the project's Auth
   settings, then flip `mailer_autoconfirm` back to false.
2. **Phone/SMS 2FA is not available** — `external_phone_enabled` is false and
   Twilio has no credentials. The delivered 2FA is TOTP (authenticator app)
   plus email confirmation on sign-up.

### Quality-audit backlog — ALL DONE 2026-07-21
- ✅ Achievements: grouped + filterable, real progress bar toward each locked
  one, a "next up" shortlist, drift-guarded against the sweep's thresholds.
- ✅ Coins: THIS WEEK flow + a proportional source breakdown + a SPEND CTA into
  Customise. (The "no spend sink" note was stale — skins/champions/palettes have
  been purchasable since migrations 030/031/044; the screen just hid it.)
- ✅ Athlete Evo pillars: StatBars with a "vs you" delta (self pulled from the
  same RPC, so both sides are on one scale).
- ✅ Gym roster: pecking-order bars, your row highlighted, "vs you" deltas.
- ✅ Gym-vs-gym battle: VsIntro splash → staggered duel reveal → verdict.

### Still open (not yet built)
- Targeted friend challenge from a notification; ranked matchmaking (Glicko-2
  already exists); a real-time ghost arena race (`ghost_snapshots` is a dead
  table); delete the dead `battle-invite` / `battle-join` edge functions.
