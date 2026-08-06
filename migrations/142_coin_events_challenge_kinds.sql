-- EvoForge 142 — the coin ledger admits the two challenge kinds.
--
-- `coin_events_kind_check` enumerates every kind the ledger accepts, and 139
-- taught the GUARD about challenge escrow without teaching the CONSTRAINT.
-- The first real accept died on the check, one layer below the guard that had
-- just approved it.
--
-- Worth stating because it will happen again: a coin kind must be added in
-- THREE places — the check constraint (may this word exist?), the guard trigger
-- (who may write it?), and the client's CoinKind union (what does it mean?).
--
--   challenge_stake   NEGATIVE. Coins leave the balance into escrow at
--                     acceptance. coin_total() is sum(amount), so a staked
--                     coin genuinely cannot be staked again.
--   challenge_payout  POSITIVE. The winner's escrow, or a draw/cancel refund.
--
-- Both stay server-only: the 139 guard admits them solely inside the challenge
-- functions, which set `evoforge.challenge_authorized` for the transaction.

begin;

alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout'
  ]));

commit;
