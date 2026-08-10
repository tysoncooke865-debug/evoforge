-- EvoForge 193 — BACKFILL exercise_id ONTO EXISTING HISTORY
-- (the training-system upgrade, 2026-08-10). Requires 192.
--
-- WHAT THIS REPAIRS. Production held 1,159 logged sets under 123 DISTINCT
-- exercise names for 17 athletes, and eleven of those groups were the same
-- movement written two ways — the fragmentation §11 asks to repair:
--
--     42 rows  'Barbell Bench Press'
--     43 rows  'Barbell Bench Press (Strength)'   <- the AI's wording
--
-- Eighty-five sets of one lift, split down the middle, with neither half
-- able to see the other's numbers or records. After this migration both
-- carry exercise_id = 'barbell_bench_press'. The full list of merges is in
-- the report at the bottom of this file.
--
-- HOW THE MAPPING WAS PRODUCED, AND WHY IT CANNOT DRIFT.
--
-- Not by hand, and not by a SQL reimplementation of the resolver. Every
-- distinct name was read out of this database, run through the REAL
-- client resolver (client/src/domain/exercise-identity.ts) and printed
-- with the id it returned. So this file cannot disagree with the running
-- app: it is the app's own answers, transcribed. Regenerate the same way
-- if it is ever replayed against a database that has since grown new names.
--
-- WHAT IT DOES NOT TOUCH. No row is deleted. No `exercise`, `weight`,
-- `reps`, `date`, `set`, `workout`, `notes`, `estimated_1rm`, `volume`,
-- `muscle` or `timestamp` value is read or written. The ONLY column
-- assigned is exercise_id, and only where it is currently null — so this is
-- idempotent, re-runnable, and a no-op on rows a newer client already
-- stamped at write time.
--
-- THE THREE STEPS ARE THE RESOLVER'S OWN ORDER, and the order matters:
--   1. catalogue / alias / descriptor names   (93 of the 123)
--   2. the athlete's OWN exercises            -> custom_<user_exercises.id>
--   3. everything else                        -> name_<slug>, its own island
-- Step 2 runs AFTER step 1 because the resolver prefers a library identity
-- over a custom row of the same name (an athlete who typed "Bench Press"
-- into CREATE should not be detached from four years of bench history).
-- Step 3 runs last because a name_ id is the fallback, never a match.
--
-- UNCERTAIN NAMES ARE LEFT AS ISLANDS, NOT GUESSED. Thirty names —
-- 'Back Squat (or Safety Bar Squat)', 'Chest-Supported Row (Machine or
-- Dumbbell)', 'EZ-Bar Curl or Barbell Curl' — name two exercises or none.
-- Each keeps a stable id of its own and merges with nothing. That is the
-- asymmetry this whole change is built on: a missed merge costs a little
-- history, a wrong one silently fuses two lifts' numbers forever.
--
-- FALSIFICATION CHECKLIST (run before AND after; 2 and 3 are the point):
--  1. `select count(*) from workout_log` unchanged            -> 1159
--  2. `select count(*) from workout_log where exercise_id is null` -> 0
--  3. checksum of the untouched columns is IDENTICAL:
--       select md5(string_agg(exercise||weight||reps||date||"set", '|'
--              order by id)) from workout_log;
--  4. the two bench spellings now share an id:
--       select exercise_id, count(*) from workout_log
--        where exercise like 'Barbell Bench Press%' group by 1;  -> one row
--  5. select as BRAVO still returns none of ALPHA's rows (RLS intact).

begin;

-- 1 ----------------------------------------------------------- catalogue
update public.workout_log w
   set exercise_id = m.id
  from (values
    ('Ab Crunch Machine', 'machine_ab_crunch'),
    ('Ab Wheel Rollout', 'ab_wheel_rollout'),
    ('Arnold Press', 'arnold_press'),
    ('Barbell Back Squat', 'barbell_back_squat'),
    ('Barbell Bench Press', 'barbell_bench_press'),
    ('Barbell Bench Press (Strength)', 'barbell_bench_press'),
    ('Barbell Deadlift', 'barbell_deadlift'),
    ('Barbell Rear Delt Row', 'barbell_rear_delt_row'),
    ('Barbell Squat', 'barbell_back_squat'),
    ('Bench Press - Powerlifting', 'bench_press_powerlifting'),
    ('Bent-Over Barbell Row', 'barbell_bent_over_row'),
    ('Bulgarian Split Squat', 'bulgarian_split_squat'),
    ('Cable Crunch', 'cable_crunch'),
    ('Cable Glute Kickback', 'cable_glute_kickback'),
    ('Cable Lat Pullover (Straight-Arm Pulldown)', 'cable_lat_pullover_straight_arm_pulldown'),
    ('Cable Lateral Raise', 'cable_lateral_raise'),
    ('Cable Rear Delt Fly', 'cable_rear_delt_fly'),
    ('Cable Triceps Pushdown', 'cable_triceps_pushdown'),
    ('Chest-Supported Dumbbell Row', 'chest_supported_dumbbell_row'),
    ('Chest-Supported Machine Row', 'chest_supported_machine_row'),
    ('Close-Grip Lat Pulldown', 'close_grip_lat_pulldown'),
    ('Dead Bug', 'dead_bug'),
    ('Decline Crunch', 'decline_crunch'),
    ('Decline Push-Up', 'decline_push_up'),
    ('Decline Sit-Up', 'decline_sit_up'),
    ('Dip Machine', 'dip_machine'),
    ('Dumbbell Bench Press', 'dumbbell_flat_bench_press'),
    ('Dumbbell Biceps Curl', 'dumbbell_biceps_curl'),
    ('Dumbbell Flat Bench Press', 'dumbbell_flat_bench_press'),
    ('Dumbbell Lateral Raise', 'dumbbell_lateral_raise'),
    ('Dumbbell Lateral Raises', 'dumbbell_lateral_raise'),
    ('Dumbbell Shrug', 'dumbbell_shrug'),
    ('EZ-Bar Curl', 'ez_bar_curl'),
    ('EZ-Bar Skullcrusher', 'ez_bar_skullcrusher'),
    ('Face Pull', 'face_pull'),
    ('Face Pulls', 'face_pull'),
    ('Hack Squat Machine', 'hack_squat_machine'),
    ('Hammer Curl', 'hammer_curl'),
    ('Hammer Curls', 'hammer_curl'),
    ('Hanging Leg Raise', 'hanging_leg_raise'),
    ('Hip Abduction Machine', 'hip_abduction_machine'),
    ('Hip Adduction Machine', 'hip_adduction_machine'),
    ('Incline Barbell Bench Press', 'incline_barbell_bench_press'),
    ('Incline Dumbbell Bench Press', 'incline_dumbbell_bench_press'),
    ('Incline Dumbbell Curl', 'incline_dumbbell_curl'),
    ('Incline Dumbbell Press', 'incline_dumbbell_bench_press'),
    ('Incline Smith Machine Bench Press', 'incline_smith_machine_bench_press'),
    ('Knee/Hip Raise On Parallel Bars', 'knee_hip_raise_on_parallel_bars'),
    ('Landmine Row', 'landmine_row'),
    ('Lat Pulldown', 'lat_pulldown'),
    ('Leg Extension', 'leg_extension'),
    ('Leg Extensions', 'leg_extension'),
    ('Leg Press', 'leg_press'),
    ('Leverage Iso Row', 'leverage_iso_row'),
    ('Low-to-High Incline Cable Fly', 'low_to_high_incline_cable_fly'),
    ('Lying Leg Curl', 'lying_leg_curl'),
    ('Lying Leg Raise', 'lying_leg_raise'),
    ('Machine Ab Crunch', 'machine_ab_crunch'),
    ('Machine Chest Press', 'machine_chest_press'),
    ('Machine High Row', 'machine_high_row'),
    ('Machine Lateral Raise', 'machine_lateral_raise'),
    ('Machine Shoulder Press', 'machine_shoulder_press'),
    ('Overhead Cable Triceps Extension', 'overhead_cable_triceps_extension'),
    ('Paused Barbell Bench Press', 'paused_barbell_bench_press'),
    ('Pec Deck Machine Fly', 'pec_deck_machine_fly'),
    ('Preacher Curl', 'preacher_curl'),
    ('Pullups', 'pullups'),
    ('Pushups', 'pushups'),
    ('Reverse Pec Deck (Rear Delt Fly)', 'reverse_pec_deck_rear_delt_fly'),
    ('Romanian Deadlift', 'romanian_deadlift'),
    ('Rope Overhead Cable Triceps Extension', 'rope_overhead_cable_triceps_extension'),
    ('Rope Triceps Pushdown', 'rope_triceps_pushdown'),
    ('Seated Cable Row', 'seated_cable_row'),
    ('Seated Cable Rows', 'seated_cable_row'),
    ('Seated Calf Raise', 'seated_calf_raise'),
    ('Seated Dumbbell Shoulder Press', 'seated_dumbbell_shoulder_press'),
    ('Seated Leg Curl', 'seated_leg_curl'),
    ('Seated/Lying Leg Curl', 'seated_lying_leg_curl'),
    ('Single-Arm Cable Rear Delt Fly', 'single_arm_cable_rear_delt_fly'),
    ('Single-Arm Cable Row', 'single_arm_cable_row'),
    ('Single-Arm Lat Pulldown', 'single_arm_lat_pulldown'),
    ('Single-Leg Leg Extension', 'single_leg_leg_extension'),
    ('Smith Machine Hip Thrust', 'smith_machine_hip_thrust'),
    ('Standing Calf Raise', 'standing_calf_raise'),
    ('Standing Dumbbell Triceps Extension', 'standing_dumbbell_triceps_extension'),
    ('Standing Overhead Barbell Press', 'overhead_barbell_press'),
    ('Standing Overhead Press', 'overhead_barbell_press'),
    ('T-Bar Row', 't_bar_row'),
    ('Weighted Plank', 'weighted_plank'),
    ('Weighted Pull-Up', 'weighted_pull_up'),
    ('Weighted Sit-Up', 'weighted_sit_up'),
    ('Wide-Grip Lat Pulldown', 'wide_grip_lat_pulldown'),
    ('Wide-Grip Seated Cable Row', 'wide_grip_seated_cable_row')
  ) as m(name, id)
 where w.exercise_id is null
   and w.exercise = m.name;

-- 2 -------------------------------------------------- the athlete's own
-- Matched on the SAME normalisation the resolver uses (lowercase, drop
-- apostrophes, fold every other non-alphanumeric run to one space), not on
-- raw equality — otherwise 'Seated  machine rows' misses its own row.
update public.workout_log w
   set exercise_id = 'custom_' || ue.id
  from public.user_exercises ue
 where w.exercise_id is null
   and ue.user_id = w.user_id
   and btrim(regexp_replace(lower(regexp_replace(ue.name, '[''‘’]', '', 'g')), '[^a-z0-9]+', ' ', 'g'))
     = btrim(regexp_replace(lower(regexp_replace(w.exercise, '[''‘’]', '', 'g')), '[^a-z0-9]+', ' ', 'g'));

-- 3 ------------------------------------------------ its own island, kept
update public.workout_log w
   set exercise_id = m.id
  from (values
    ('Ab Wheel Rollout or Plank Variation', 'name_ab_wheel_rollout_or_plank_variation'),
    ('Back Squat (or Safety Bar Squat)', 'name_back_squat_or_safety_bar_squat'),
    ('Barbell Bent-Over Row (medium grip)', 'name_barbell_bent_over_row_medium_grip'),
    ('Cable Chest Fly (plate loaded or single-arm)', 'name_cable_chest_fly_plate_loaded_or_single_arm'),
    ('Cable Fly (low to high)', 'name_cable_fly_low_to_high'),
    ('Cable isolated pushdown', 'name_cable_isolated_pushdown'),
    ('Cable Lateral Raise (leaning, single-arm)', 'name_cable_lateral_raise_leaning_single_arm'),
    ('Cable Overhead Triceps Extension (Rope)', 'name_cable_overhead_triceps_extension_rope'),
    ('Cable Triceps Pressdown (rope)', 'name_cable_triceps_pressdown_rope'),
    ('Chest-Supported Row (Machine or Dumbbell)', 'name_chest_supported_row_machine_or_dumbbell'),
    ('Close grip tricep push down', 'name_close_grip_tricep_push_down'),
    ('Conventional Deadlift or Trap Bar Deadlift', 'name_conventional_deadlift_or_trap_bar_deadlift'),
    ('EZ-Bar Curl (Standing)', 'name_ez_bar_curl_standing'),
    ('EZ-Bar Curl (Strict, Against Wall if Possible)', 'name_ez_bar_curl_strict_against_wall_if_possible'),
    ('EZ-Bar Curl or Barbell Curl', 'name_ez_bar_curl_or_barbell_curl'),
    ('Face Pulls (high rep)', 'name_face_pulls_high_rep'),
    ('Funny forearm machine', 'name_funny_forearm_machine'),
    ('Hammer Strength High Row or Cable Wide Row', 'name_hammer_strength_high_row_or_cable_wide_row'),
    ('High-Rep Dumbbell Lateral Raise (Drop Set Last Set)', 'name_high_rep_dumbbell_lateral_raise_drop_set_last_set'),
    ('Incline Barbell Press (Medium Grip)', 'name_incline_barbell_press_medium_grip'),
    ('Isolated tricep pull down right', 'name_isolated_tricep_pull_down_right'),
    ('Isollated tricep pull down left', 'name_isollated_tricep_pull_down_left'),
    ('Lat Pulldown (wide, slow negative)', 'name_lat_pulldown_wide_slow_negative'),
    ('Leg Press (feet low)', 'name_leg_press_feet_low'),
    ('Overhead Rope Extension or Skull Crushers', 'name_overhead_rope_extension_or_skull_crushers'),
    ('Rear Delt Dumbbell Fly (incline)', 'name_rear_delt_dumbbell_fly_incline'),
    ('Seated Cable Row (Close or Neutral Grip)', 'name_seated_cable_row_close_or_neutral_grip'),
    ('Seated machine rows', 'name_seated_machine_rows'),
    ('Weighted Dip (leaning)', 'name_weighted_dip_leaning'),
    ('Weighted Pull-Ups (wide grip)', 'name_weighted_pull_ups_wide_grip')
  ) as m(name, id)
 where w.exercise_id is null
   and w.exercise = m.name;

commit;

-- ---------------------------------------------------------------------
-- THE ELEVEN MERGES THIS PERFORMS (verified against production data on
-- 2026-08-10; row counts are at that moment):
--
--   barbell_bench_press           85   Barbell Bench Press
--                                      Barbell Bench Press (Strength)
--   barbell_back_squat            45   Barbell Back Squat / Barbell Squat
--   dumbbell_flat_bench_press     31   Dumbbell Bench Press
--                                      Dumbbell Flat Bench Press
--   dumbbell_lateral_raise        30   Dumbbell Lateral Raise(s)
--   incline_dumbbell_bench_press  24   Incline Dumbbell Bench Press
--                                      Incline Dumbbell Press
--   overhead_barbell_press        24   Standing Overhead (Barbell) Press
--   hammer_curl                   23   Hammer Curl / Hammer Curls
--   leg_extension                 17   Leg Extension / Leg Extensions
--   seated_cable_row              14   Seated Cable Row / Rows
--   machine_ab_crunch             12   Machine Ab Crunch / Ab Crunch Machine
--   face_pull                      8   Face Pull / Face Pulls
--
-- 123 names -> 112 identities. Nothing else changed.
