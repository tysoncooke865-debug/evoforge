-- EvoForge 075 — retire the RPG CHALLENGE-BY-CODE system (Tyson, 2026-07-20).
--
-- Champion turn-by-turn battles now use real-time QUICK MATCH matchmaking
-- (migration 074) instead of minting/sharing a 6-char challenge code. The 034
-- rpg_challenges table + its three RPCs have no remaining client references
-- (battle-rpg-challenge.ts and challenge-hub.tsx deleted; battle.tsx's challenge
-- mode removed; the Arena JOIN box is now fitness-duel-only). Drop them.
--
-- NOTE: this is the RPG champion challenge ONLY. System A's battle_matches
-- invite_code (the real-WORKOUT fitness duel) is a separate feature and stays.
--
-- FALSIFICATION: the three functions and the table no longer exist; nothing else
-- references rpg_challenges (grep of migrations shows only 034 + this).

drop function if exists public.create_rpg_challenge(text, text, jsonb);
drop function if exists public.get_rpg_challenge(text);
drop function if exists public.record_rpg_challenge_result(text, boolean);
drop table if exists public.rpg_challenges;
