-- EvoForge 097 — COMMAND: progress that is measured, and a floor that moves.
--
-- Tyson: "i would like the progress bar on the agents to be much more accurate
-- and rerfresh more often, it should pretty much show exactly how far into the
-- progress it is each time i open the page".
--
-- TWO FAULTS, AND THE FIRST ONE IS THE 091 FAULT AGAIN.
--
-- 1. THE BAR WAS FIVE HARDCODED NUMBERS. The runner wrote progress 5, 15, 30,
--    70, 100 at fixed points in its own control flow. The step it writes 30 for
--    is "Claude Code is working", which is the phase that takes TWENTY MINUTES —
--    so the bar sat at 30% for essentially the whole job and then leapt to 100.
--    It was not measuring the work; it was numbering the runner's own lines of
--    code. This product exists because a bar at 0% and a bar about to move look
--    identical, and a bar frozen at 30% for twenty minutes is the same lie with
--    a different number on it.
--
--    Progress now moves on OBSERVED EVENTS. The runner reads Claude Code's
--    stream-json output and advances on each real tool use, recording what the
--    agent is doing as it goes. `activity` is that sentence.
--
--    On honesty about the number: the true fraction of an open-ended agent task
--    is not knowable, and inventing precision would be the same sin in a third
--    costume. So the working band approaches its ceiling asymptotically and
--    only ever reaches it when the run ACTUALLY ends — the bar can never claim
--    to be nearly finished on the strength of a guess — and `activity` states
--    the evidence behind the number in words next to it.
--
-- 2. THE FLOOR NEVER REFRESHED. The page is force-dynamic, which re-renders per
--    REQUEST — and nothing made a request. Opening the floor showed whatever was
--    true at load and then decayed silently. command_tasks joins the realtime
--    publication so the page can follow the work instead of describing a moment
--    that has passed.
--
-- FALSIFICATION CHECKLIST:
--   1. update a task's progress -> a realtime subscriber receives it.   [live]
--   2. `activity` survives a command_agent_update that does not set it. [keep]
--   3. founders can still only SELECT command_tasks.                     [RLS]

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WHAT THE AGENT IS DOING, IN WORDS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_tasks
  add column if not exists activity    text,
  add column if not exists activity_at timestamptz,
  -- Real counters, so the bar is auditable rather than merely plausible: a
  -- founder can ask "why does it say 48%" and the answer is a number of tool
  -- calls and a list of files, not a curve.
  add column if not exists tool_calls  integer not null default 0;

comment on column public.command_tasks.activity is
  'What the agent is doing RIGHT NOW, in one line — "Editing client/src/x.ts". '
  'Written from Claude Code''s streamed tool-use events, not inferred.';
comment on column public.command_tasks.tool_calls is
  'Observed tool uses in the current run. The evidence the progress bar moves on.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LIVE
-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime needs the row's identity on UPDATE to deliver a useful payload.
-- DEFAULT (primary key) is enough here and is far cheaper than FULL, which
-- would ship every column of every progress tick over the socket.
alter table public.command_tasks replica identity default;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'command_tasks'
  ) then
    alter publication supabase_realtime add table public.command_tasks;
  end if;
end $$;

-- The runner's presence row drives the same floor, so it follows the same rule.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'command_runners'
  ) then
    alter publication supabase_realtime add table public.command_runners;
  end if;
end $$;

-- Realtime authorises through RLS, so this changes no access: founders already
-- hold SELECT on both tables and nothing else. A non-founder subscribing
-- receives an empty stream rather than a refusal, which is the correct shape.
