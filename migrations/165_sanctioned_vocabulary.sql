-- EvoForge 165 — THE LAST OF THE BANNED WORDS, WHERE A USER CAN ACTUALLY READ THEM.
--
-- Spec v5 §10 bans "stake" on every user-facing surface, and a `raise exception`
-- inside a live function IS one: PostgREST hands the message to the client and the
-- app renders it in a toast. Eight were left after the client sweep, and five of
-- them live in functions rather than in copy.
--
-- WHY A NEW MIGRATION RATHER THAN EDITING 144, 145 AND 152.
--
-- Those three are APPLIED. Editing an applied migration changes the repo and not
-- the database, which makes the file lie about what ran — the exact divergence this
-- session has now hit four separate times (159 uncommitted-but-applied,
-- grant_battle_reward's parameter order, hit_probability, max_support). I did edit
-- them, briefly, and reverted: the text in an applied migration is a record, not a
-- source of truth to be corrected.
--
-- So the messages change the only way they honestly can — by redefining the live
-- functions here.
--
-- WHAT IS NOT TOUCHED: identifiers. `current_stake`, `stake`, `min_stake` and the
-- `callout_stake` ledger kind all keep their names. §10 bans the word in what a
-- human reads, and renaming live columns and enum values to satisfy a copy rule
-- would be a migration with real risk and no compliance value.

begin;

-- ───────────────────────────────── the duel's refusals, reworded

do $$
declare
  fn record;
  src text;
  fixed text;
  n int := 0;
begin
  /**
   * REWRITTEN FROM THE LIVE BODIES, not from the migration files — because the
   * files and the database have disagreed every time this session has checked.
   * Each function is fetched, its user-facing strings substituted, and the result
   * re-executed. Anything that does not actually contain a banned word is skipped,
   * so re-running this migration is a no-op.
   */
  for fn in
    select p.oid,
           p.proname,
           pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public'
      -- DRIVEN BY THE PHRASES, NOT BY A LIST OF NAMES. The first version named five
      -- functions I expected to be guilty and the verification below immediately
      -- found a sixth — `forge_duel_invite_guard`, a trigger function nobody would
      -- think to look in. Any function that says one of these gets rewritten,
      -- whoever it is.
      and (pg_get_functiondef(p.oid) like '%the stake is locked once the duel starts%'
        or pg_get_functiondef(p.oid) like '%only the invited athlete may counter the stake%'
        or pg_get_functiondef(p.oid) like '%A stake must be between%'
        or pg_get_functiondef(p.oid) like '%A duel stake must be between%'
        or pg_get_functiondef(p.oid) like '%A single duel may stake at most%'
        or pg_get_functiondef(p.oid) like '%callout_create: stake must be between%')
  loop
    src := fn.def;
    fixed := src;

    -- Only inside single-quoted message text; the identifiers around them stay.
    fixed := replace(fixed, 'the stake is locked once the duel starts',
                            'the pledge is locked once the duel starts');
    fixed := replace(fixed, 'only the invited athlete may counter the stake',
                            'only the invited athlete may counter the pledge');
    -- LONGEST FIRST: 'A stake must be between' is a substring of 'A duel stake
    -- must be between', so the short one would eat the long one and leave
    -- "A duel pledge must be between" unreachable.
    fixed := replace(fixed, 'A duel stake must be between',   'A duel pledge must be between');
    fixed := replace(fixed, 'A stake must be between',        'A pledge must be between');
    fixed := replace(fixed, 'A single duel may stake at most','A single duel may pledge at most');
    fixed := replace(fixed, 'callout_create: stake must be between',
                            'callout_create: the pledge must be between');

    if fixed is distinct from src then
      execute fixed;
      n := n + 1;
      raise notice 'reworded %', fn.proname;
    end if;
  end loop;

  if n = 0 then
    raise notice 'nothing to reword — already sanctioned';
  end if;
end $$;

-- ─────────────────────── PROVEN NOT ASSUMED: no live function says it

/**
 * THE SPECIFIC PHRASES, GONE FROM EVERY LIVE FUNCTION.
 *
 * The first version of this searched every function body for the banned words
 * inside quotes, and named nine functions — most of them false positives. A
 * `pg_get_functiondef` includes the body's CODE COMMENTS, and an apostrophe in
 * ordinary prose ("the athlete's own best") opens a pseudo-quoted region that
 * swallows whatever follows. `forge_reveal_claim` was flagged for a comment
 * explaining why the staked board took a stake and this one does not.
 *
 * Pattern-matching prose out of SQL is not worth getting right here. The
 * file-based sweep (tools/sweep-vocabulary.mjs) already strips comments properly
 * and is the primary guard; this one asserts the exact substitutions landed, which
 * is precise, checkable, and cannot cry wolf.
 */
do $$
declare
  phrase text;
  culprit text;
  gone text[] := array[
    'the stake is locked once the duel starts',
    'only the invited athlete may counter the stake',
    'A stake must be between',
    'A duel stake must be between',
    'A single duel may stake at most',
    'callout_create: stake must be between'
  ];
begin
  foreach phrase in array gone loop
    select string_agg(distinct p.proname, ', ') into culprit
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_functiondef(p.oid) like '%' || phrase || '%';
    if culprit is not null then
      raise exception 'a live function still says "%": %', phrase, culprit;
    end if;
  end loop;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   -- Re-apply 144, 145 and 152's original bodies. There is no reason to: the only
--   -- change is wording, and the wording is the compliance requirement.
-- commit;
