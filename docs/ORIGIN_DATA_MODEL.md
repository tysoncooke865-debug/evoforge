# Origin data model — migration 047 (2026-07-17)

Migration numbering [CONFIRMED]: applied through 046; 022 absent and 037
duplicated are PRE-EXISTING quirks, never to be repaired retroactively.
This program ships `047_origin_onboarding.sql`. Previously deployed
migration files are never rewritten.

## 1. profile — new columns (all nullable/defaulted: zero-downtime, no rewrite)

| Column | Type | Purpose |
|---|---|---|
| `primary_goal` | text CHECK in ('strength','muscle_gain','fat_loss','cardio','aesthetics') | the Destined input; mirrors `paths.fitness_category` vocabulary |
| `battle_style` | text CHECK in ('force','form','flow') | the Anomaly input; mirrors the deployed battle style triangle |
| `onboarding_flow_version` | integer | 2 = origin-in-onboarding flow; NULL/absent = legacy user → the (main) gate never traps them |
| `firstbound_origin` | text REFERENCES paths(slug) | permanent history; written once by binding, NEVER updated afterwards (guard trigger) |
| `reforge_granted_at` | timestamptz | free-reforge grant timestamp, write-once |
| `reforge_used_at` | timestamptz | reforge consumption, write-once |

[CONFIRMED] existing origin columns (039) keep their exact semantics:
`origin_path` (write-once via RPC except reforge), `active_path`,
`active_stage`, `origin_assigned_at`, `origin_assignment_version`,
`migration_status`.

## 2. Origin Mastery [decision: reuse, don't duplicate]

Origin Mastery **is `user_paths.path_xp`** (existing integer, default 0,
definer-write-only). 047 adds a BEFORE UPDATE guard trigger on
`user_paths`: `path_xp` and `current_stage` can never decrease, `is_origin`
flips are RPC-only (already true — no client write policy exists).
[REJECTED] a parallel origin_mastery table — a second XP economy for the
same concept is the exact failure the XP-contract doctrine forbids.

## 3. Champion Bond — new table

```sql
user_champion_bond (
  id uuid pk,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  champion text not null check (champion in ('aesthetic','titan','apex','shredded','gymerica')),
  bond_xp integer not null default 0 check (bond_xp >= 0),
  created_at/updated_at timestamptz,
  unique (user_id, champion)
)
```
Owner-only SELECT; NO client insert/update/delete policies (definer RPCs
are the only writers — the 030/031 pattern). BEFORE UPDATE trigger:
bond_xp never decreases. Binding seeds bond_xp 0 for the origin's default
champion; future gameplay feeds it (out of scope here).

## 4. Binding RPC — `assign_origin_path(p_path)` v5 [CHANGED in place]

Same name/signature (client compatibility: evo-scan auto-claim, the Forge
reveal, and the new onboarding all call it). v5 body:

1. `pg_advisory_xact_lock(hashtext(auth.uid()::text))` — serialises
   double-taps and two-device races (the 030/031/044 pattern).
2. Write-once: `origin_path` already set → `{ok:false, reason:'already_assigned'}`
   (clients treat as success-shaped; refetch).
3. Validation: `p_path ∈ origin_candidates_for(uid).candidates` **or**
   `p_path ∈ classify_evo_path().choices` (v4 compat while the legacy
   reveal survives) **or** the v4 shredder-eligibility allowance.
   Invalid slug → FK/CHECK rejection; outside the set → `'not_offered'`.
4. Awards, atomically (one transaction): evo_assessments row (v5 snapshot,
   `followed_recommendation`), user_paths upsert (is_origin, unlocked,
   stage preserve-higher ≥1), `user_champion_bond` seed row (ON CONFLICT
   DO NOTHING — idempotent), profile update (origin/active/equip,
   `firstbound_origin = COALESCE(firstbound_origin, p_path)`,
   migration_status 'classified'), audit log row.
5. Returns `{ok, origin_path, stage, champion, firstbound}`.

Exactly-once guarantees: the write-once check inside the advisory lock is
the idempotency key; user_paths/bond upserts are ON CONFLICT-safe, so even
a hypothetical replay cannot duplicate rows. Auditable: evo_assessments +
user_path_migration_log rows per successful bind.

## 5. Free Reforge

- `claim_free_reforge()` (authenticated, definer, advisory-locked):
  requires `origin_path` set, `reforge_granted_at` null, and ≥3 DISTINCT
  `workout_log` dates with ≥1 valid set (weight>0, reps>0) **strictly
  after `origin_assigned_at`** — the deployed forge_claim_weekly
  "trained day" predicate [CONFIRMED], re-proved inside the definer, never
  client-counted. Sets `reforge_granted_at` (write-once). Returns
  remaining-days info for the UI when not yet eligible.
- `reforge_origin(p_path)` (authenticated, definer, advisory-locked):
  requires granted && `reforge_used_at` null; regenerates candidates v5
  (now evidence-rich); validates `p_path ∈ candidates`; if `p_path` equals
  the current origin → `{ok:false, reason:'same_origin'}` (keeping your
  origin never consumes the credit — "keep" is a client-side dismiss);
  otherwise: archive previous state to the audit log, set
  `origin_path/active_path/active_stage` to the new origin (stage
  preserve-higher ≥1 on its user_paths row, is_origin moves), seed the new
  champion's bond row, set `reforge_used_at`. `firstbound_origin`
  untouched. **[CHANGED by 048, Tyson 2026-07-17]** the previous origin is
  WIPED (its user_paths row + its champion's bond row deleted), not kept —
  "nobody should have any data on any character other than their origin."
- Workout-count manipulation [documented limitation]: workout_log is
  owner-insertable (root CLAUDE.md problem #7) — the gate is as strong as
  the rest of the app's workout economy, no weaker (definer re-proof, no
  client-supplied count) and no stronger (fabricated-but-plausible history
  passes, as it already does for XP/coins).

## 6. RLS summary

- New profile columns ride profile's existing owner-only policies; the
  client can technically write its own goal/battle_style (they are
  self-report inputs — same trust tier as bodyweight). `firstbound_origin`
  and reforge timestamps are guarded by a BEFORE UPDATE trigger
  (write-once regardless of writer), so a raw PATCH cannot fake or clear
  them.
- `user_champion_bond`: owner SELECT only; zero client write policies.
- No new cross-user reads anywhere.

## 7. Rollback + concurrency review

- All DDL is additive (columns nullable, new table, CREATE OR REPLACE
  functions). Rollback = flip client flags off; schema can stay.
- Concurrency: every mutating RPC takes the per-user advisory lock;
  guard triggers are last-line (they hold even against future buggy RPCs).
- The v4 classifier and all deployed surfaces keep working untouched if
  the new client never ships (the migration is deployable first — CI
  auto-deploys edge functions but SQL is applied via the management API
  before the client push, the established order).

## 8. Analytics table [CONFIRMED, reused]

`analytics_events` (029) is the rail; no schema change. Event vocabulary
in ORIGIN_ANALYTICS.md.
