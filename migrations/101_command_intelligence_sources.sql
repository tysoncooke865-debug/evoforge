-- EvoForge 101 — COMMAND: the competitor roster and an honest integration registry.
--
-- TWO RULES THIS FILE EXISTS TO ENFORCE.
--
-- 1. NO INVENTED COMPETITOR FACTS. The brief names thirteen competitors, and it
--    would be trivial to seed each with a plausible feature matrix from general
--    knowledge. That would be fabrication: a profile written from memory is
--    indistinguishable, in the database, from one collected today — and the
--    entire Scout output would then rest on recollection presented as research.
--    So the roster is seeded with IDENTITY ONLY (name, platforms, store URL),
--    every profile is empty, and last_reviewed is NULL. The UI reads NULL as
--    "never collected" and says so.
--
-- 2. NO INTEGRATION MAY LOOK LIVE WHEN IT IS NOT. command_integrations is the
--    single place the interface asks "can I actually see this?" — and it
--    distinguishes live / configured-but-unavailable / manual / planned, with
--    the exact setup still required written down. A dashboard that renders an
--    absent feed as an empty chart is lying quietly; this makes that
--    impossible, because the status travels with the data.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INTEGRATION STATUS — the honesty registry
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_integrations (
  key           text primary key,
  label         text not null,
  category      text not null,
  status        text not null check (status in ('live','configured_unavailable','manual','planned','absent')),
  detail        text not null,
  setup_required text,
  last_success  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('analytics_internal','EvoForge analytics_events','analytics','live',
   'Read directly from the shared Supabase project. Pulse queries it and records every figure with the SQL that produced it.', null),
  ('error_monitoring','Sentry / error reporting','reliability','planned',
   'Migration 094 and the client reporter were written by an agent but are NOT applied or enabled. Treat error counts as unavailable, not zero.',
   'Apply migration 094, set SENTRY_DSN, deploy sentry-watch, upload source maps in CI.'),
  ('app_store_reviews','App Store / Play reviews','user_feedback','absent',
   'No permitted automated source is wired. Review themes must be entered as manual evidence with a URL and a date.',
   'Either a licensed reviews API, or a documented manual collection routine.'),
  ('competitor_web','Competitor public web research','competitor','manual',
   'Scout has no scraping capability. Findings are entered as evidence with source_ref and collected_at, and expire.',
   'Optional: a compliant research provider. Public marketing pages and store listings may be read within their terms.'),
  ('session_replay','Session replay','user_feedback','absent',
   'Not integrated. No replay-derived claim may appear anywhere.',
   'A replay vendor plus an explicit privacy review — EvoForge stores physique photos and this is a HIGH-risk category.'),
  ('feature_flags','Feature flags','release','absent',
   'No flag service. Staged rollout is currently branch-and-deploy, so experiments cannot be split by cohort yet.',
   'A flag provider, or a flags table plus a client hook.'),
  ('deployments','Cloudflare Pages / Vercel','release','live',
   'Client deploys via GitHub Actions to Cloudflare Pages; Command deploys to Vercel (syd1).', null),
  ('git_execution','Git execution','execution','live',
   'The runner holds a scoped GitHub PAT and pushes from isolated worktrees. Verified at startup on every boot.', null),
  ('model_execution','Claude Code','execution','live',
   'Print mode with stream-json. Tools are restricted to Read,Grep,Glob,Edit,Write — agents CANNOT run builds or tests.', null),
  ('push_notifications','Web push','notification','live',
   'command_outbox + exec-notify. One push per run.', null)
on conflict (key) do update set
  label = excluded.label, category = excluded.category, status = excluded.status,
  detail = excluded.detail, setup_required = excluded.setup_required, updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE COMPETITOR ROSTER — identity only, deliberately unprofiled
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_competitors (key,name,platforms,profile,last_reviewed) values
  ('hevy','Hevy','{ios,android,web}','{}'::jsonb,null),
  ('liftoff','Lift Off','{ios,android}','{}'::jsonb,null),
  ('strong','Strong','{ios,android}','{}'::jsonb,null),
  ('fitbod','Fitbod','{ios,android}','{}'::jsonb,null),
  ('alpha_progression','Alpha Progression','{ios,android}','{}'::jsonb,null),
  ('boostcamp','Boostcamp','{ios,android}','{}'::jsonb,null),
  ('cal_ai','Cal AI','{ios,android}','{}'::jsonb,null),
  ('myfitnesspal','MyFitnessPal','{ios,android,web}','{}'::jsonb,null),
  ('macrofactor','MacroFactor','{ios,android}','{}'::jsonb,null),
  ('rp_hypertrophy','RP Hypertrophy','{ios,android}','{}'::jsonb,null),
  ('ladder','Ladder','{ios,android}','{}'::jsonb,null),
  ('gymshark_training','Gymshark Training','{ios,android}','{}'::jsonb,null)
on conflict (key) do nothing;

comment on table public.command_competitors is
  'Roster only until Scout collects verified observations. last_reviewed IS NULL '
  'means NEVER COLLECTED — the interface must render that as unknown, never as '
  '"no gaps found". A profile written from an agent''s general knowledge would be '
  'fabrication wearing the costume of research.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_integrations enable row level security;
drop policy if exists command_integrations_read on public.command_integrations;
create policy command_integrations_read on public.command_integrations for select using (public.is_founder());
revoke insert, update, delete on public.command_integrations from authenticated, anon;
