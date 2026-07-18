-- EvoForge 059 — POST REPORTS, record-only v1
-- (Tyson's improvement doc §6.2, 2026-07-19).
--
-- A REPORT action for inappropriate posts/photos. v1 RECORDS, it does not
-- auto-hide: moderation without review tooling would be a mocked system
-- (the hidden-never-mocked doctrine), and a threshold auto-hide hands
-- strangers a takedown button. Reports are readable by service role ONLY —
-- there is deliberately NO client select policy, so nobody can probe who
-- reported whom. Duplicate reports collapse on (reporter, post).
--
-- FALSIFICATION CHECKLIST (ALPHA/BRAVO, delete via service after):
--  1. BRAVO reports a visible post → 201.
--  2. the same report again → unique violation.
--  3. BRAVO selects social_reports → zero rows (no select policy).
--  4. reporter_id forged to someone else → RLS rejection.
--  5. bad reason value → CHECK rejection.

create table if not exists public.social_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id     uuid not null references public.social_posts(id) on delete cascade,
  reason      text not null check (reason in ('spam','abuse','nsfw','other')),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  unique (reporter_id, post_id)
);

alter table public.social_reports enable row level security;

-- INSERT-only for the reporter. No select/update/delete policies at all:
-- the review surface is service-role SQL until admin tooling exists.
drop policy if exists social_reports_insert on public.social_reports;
create policy social_reports_insert on public.social_reports
  for insert to authenticated with check (reporter_id = auth.uid());

grant insert on public.social_reports to authenticated;
