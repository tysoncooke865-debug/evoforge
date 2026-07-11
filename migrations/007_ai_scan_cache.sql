-- 007: AI scan cache + rate-limit surface (MIGRATION_PLAN "AI via Edge Functions").
--
-- Run BY HAND in the Supabase SQL editor, like 001-006. Idempotent.
--
-- Two jobs, one table:
--   * COST CONTROL. Every Edge Function call logs one row. The functions count
--     the caller's rows in the last hour BEFORE calling OpenAI and refuse past
--     the cap -- the wallet's circuit breaker.
--   * RESULT CACHE. `sha256(image bytes)` keys a scan; re-scanning the same
--     photo returns the stored result without an OpenAI round trip.
--
-- Photos are NEVER stored -- only their hash and the JSON verdict. Owner-only
-- RLS like every other table; the Edge Functions run with the caller's JWT, so
-- inserts land as the caller and the cache cannot leak across users.

create table if not exists public.ai_scan_cache (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    kind        text not null check (kind in ('physique', 'bodyfat', 'coach', 'plan')),
    image_hash  text not null,
    result      jsonb not null,
    created_at  timestamptz not null default now()
);

alter table public.ai_scan_cache enable row level security;

drop policy if exists "ai_scan_cache_select_own" on public.ai_scan_cache;
create policy "ai_scan_cache_select_own" on public.ai_scan_cache
    for select using (auth.uid() = user_id);

drop policy if exists "ai_scan_cache_insert_own" on public.ai_scan_cache;
create policy "ai_scan_cache_insert_own" on public.ai_scan_cache
    for insert with check (auth.uid() = user_id);

-- No update/delete policies: the cache is append-only, like the ledger.

-- Cache lookups + the hourly rate-limit count both hit this.
create index if not exists ai_scan_cache_user_kind_hash
    on public.ai_scan_cache (user_id, kind, image_hash);
create index if not exists ai_scan_cache_user_created
    on public.ai_scan_cache (user_id, created_at desc);
