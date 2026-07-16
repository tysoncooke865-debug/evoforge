-- EvoForge 027 — PROGRESSION_OVERHAUL P6: guided Evo Scans + Evolution
-- Chapters.
--
--   physique_assessments — one row per official guided scan: measurements,
--     the judge's sub-scores + regional scores, confidence, status
--     ('confirmed' | 'pending_confirmation' when the change is too large —
--     spec §15C), model version. IMAGES ARE NOT STORED for solo scans —
--     the battle amendment (BATTLE_ARENA D2) stays the ONLY exception to
--     the never-persist rule; a scan stores sha256 hashes only, exactly
--     like ai_scan_cache. (The spec's private-bucket design is therefore
--     NOT needed for solo scans; storage cost zero, leak surface zero.)
--   evolution_chapters — the 12-week recap anchors (spec §15D).
--
-- Owner-only RLS everywhere; assessments and chapters are append-only to
-- clients (no update/delete policies) — the edge function marks
-- pending→confirmed via service role.
--
-- FALSIFICATION: B reads 0 of A's rows; client UPDATE hits 0 rows.

create table if not exists public.physique_assessments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  scan_type             text not null default 'monthly_guided'
                        check (scan_type in ('monthly_guided','confirmation','onboarding')),
  bodyweight_kg         numeric(6,2),
  waist_cm              numeric(6,2),
  measurements          jsonb not null default '{}'::jsonb,
  image_hashes          jsonb not null default '[]'::jsonb,
  size_score            numeric(8,4),
  aesthetics_score      numeric(8,4),
  proportions_score     numeric(8,4),
  distribution_score    numeric(8,4),
  definition_score      numeric(8,4),
  symmetry_score        numeric(8,4),
  regional_scores       jsonb not null default '{}'::jsonb,
  confidence            integer not null default 0,
  status                text not null default 'confirmed'
                        check (status in ('confirmed','pending_confirmation','superseded','rejected')),
  model_version         text not null,
  assessment_date       date not null,
  created_at            timestamptz not null default now()
);

create index if not exists physique_assessments_user_idx
  on public.physique_assessments (user_id, assessment_date desc);

alter table public.physique_assessments enable row level security;
create policy "own assessments select" on public.physique_assessments
  for select using (user_id = auth.uid());
create policy "own assessments insert" on public.physique_assessments
  for insert with check (user_id = auth.uid());

-- The scan cache/rate-limit table must accept the new kind (the 021
-- lesson: 007's check silently killed both cache AND limiter for a new
-- kind — storeCache swallows errors, rateLimited counts the same table).
alter table public.ai_scan_cache drop constraint if exists ai_scan_cache_kind_check;
alter table public.ai_scan_cache add constraint ai_scan_cache_kind_check
  check (kind in ('bodyfat','physique','plan','plan-scan','evo-scan'));

create table if not exists public.evolution_chapters (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  chapter_number        integer not null check (chapter_number >= 1),
  started_at            date not null,
  ended_at              date,
  starting_snapshot_id  uuid references public.evo_rating_snapshots(id),
  ending_snapshot_id    uuid references public.evo_rating_snapshots(id),
  summary               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (user_id, chapter_number)
);

alter table public.evolution_chapters enable row level security;
create policy "own chapters select" on public.evolution_chapters
  for select using (user_id = auth.uid());
create policy "own chapters insert" on public.evolution_chapters
  for insert with check (user_id = auth.uid());
create policy "own chapters update" on public.evolution_chapters
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
