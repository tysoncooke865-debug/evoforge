-- 015_arena_mini_games.sql — BATTLE_ARENA_DESIGN.md §16 (D5–D9 answered
-- 2026-07-12): two single-round duel formats, VOLUME DUEL and HEADS OR
-- TAILS. Constraint-widening only — no new tables, no new policies, no
-- trigger changes. The 009 battle_events guard already does everything the
-- duels need:
--   * 'volume' events are validated round-open + in-window + owned-row
--     regardless of the ROUND's kind, so a 'volume_duel' round works as-is;
--   * client inserts of any kind outside its explicit branches fall through
--     to `raise 'unsupported kind'`, so the new 'pick' kind is SERVER-ONLY
--     by construction (the service role returns early at the top).
-- Streamlit is untouched (its schema never sees these tables).

-- STEP 1 — battle_matches.format learns the duel formats
alter table public.battle_matches
  drop constraint if exists battle_matches_format_check;
alter table public.battle_matches
  add constraint battle_matches_format_check
  check (format in ('blitz', 'full', 'volume_duel', 'heads_or_tails'));

-- STEP 2 — battle_rounds.kind learns the duel round kinds
alter table public.battle_rounds
  drop constraint if exists battle_rounds_kind_check;
alter table public.battle_rounds
  add constraint battle_rounds_kind_check
  check (kind in ('strength', 'cardio', 'physique', 'volume_duel', 'heads_or_tails'));

-- STEP 3 — battle_events.kind learns 'pick' (heads-or-tails coin-flip picks,
-- written exclusively by the battle-pick edge function via the service role)
alter table public.battle_events
  drop constraint if exists battle_events_kind_check;
alter table public.battle_events
  add constraint battle_events_kind_check
  check (kind in ('volume', 'cardio', 'photo_hash', 'ready', 'forfeit', 'flag', 'pick'));

-- STEP 4 — falsification checklist (run as a signed-in PARTICIPANT client,
-- each must FAIL; then the positive control must PASS):
--   (a) INSERT battle_matches format='volume_duel' directly
--         -> RLS: clients have no write path to battle_matches at all.
--   (b) INSERT battle_events kind='pick'
--         -> guard: "unsupported kind pick" (server-only by construction).
--   (c) UPDATE battle_matches SET format='banana'
--         -> RLS denies first; the check would too.
--   (d) INSERT battle_events kind='volume' on a volume_duel round with an
--       owned in-window workout_log id
--         -> MUST SUCCEED (positive control: the guard is round-kind
--            agnostic; this is the whole game).
--   (e) Same insert with the round window expired -> "round is not open".
