-- EvoForge 200 — THE PAGE LAB'S CULL LIST BECOMES DURABLE (2026-09-04).
--
-- WHAT THIS IS. The dev-only Page Lab (lab.evoforge.pages.dev) hides a losing
-- redesign batch the moment the developer culls it. Until now that decision
-- lived in localStorage — per device, per browser — so a batch culled on the
-- desktop rose from the dead on the phone. This table is the cull list's
-- durable home: one row per (developer, culled batch), pulled and merged into
-- the local store when the gallery mounts with a real session underneath
-- (client/src/lab/cull-sync.ts). localStorage remains the synchronous source
-- of truth for render and the whole fallback when signed out.
--
-- WHAT THIS IS NOT. Not a product table — no athlete-facing surface reads it,
-- and no lab surface WRITES anything else real. Not the deletion itself: a
-- culled batch's files still leave the repo only by a commit (the gallery's
-- PENDING REMOVAL list is that commit's work order). A row here whose batch
-- has since been deleted is harmless — the client registry is the only truth
-- about what exists, and stale keys are ignored on read.
--
-- SHAPE. `cull_key` is the client's exact storage grammar, `<page>/batch-<n>`
-- (client/src/lab/cull-model.ts), CHECK-pinned server-side so a corrupted
-- write can never round-trip back into the parser as garbage. The PK makes a
-- re-cull an idempotent upsert; there is deliberately NO update policy — a
-- cull is insert-or-delete, nothing about a row ever changes.
--
-- RLS. Owner-only, the house pattern: `user_id uuid DEFAULT auth.uid()`,
-- select/insert/delete for the owner alone. No security-definer anything, no
-- trigger, no GUC — this is the simplest table in the database and must stay
-- that way.
--
-- FALSIFICATION CHECKLIST (run before the client commit that depends on it):
--  1. ALPHA inserts 'home/batch-1' → row lands, user_id = ALPHA.
--  2. BRAVO selects → zero rows (not BRAVO's culls to see).
--  3. BRAVO deletes ALPHA's row → zero rows affected.
--  4. ALPHA inserts with an explicit user_id = BRAVO → rejected by WITH CHECK.
--  5. ALPHA inserts 'home/clarity' (the retired variant grammar) → rejected
--     by the CHECK constraint.
--  6. Anonymous select → zero rows.
--  7. Re-inserting the same key as ALPHA (upsert, ignoreDuplicates) → no
--     error, still one row.
--  Clean the smoke rows afterwards.

begin;

create table if not exists public.lab_culls (
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  cull_key   text not null
             check (cull_key ~ '^[a-z0-9-]+/batch-[1-9][0-9]*$'),
  created_at timestamptz not null default now(),
  primary key (user_id, cull_key)
);

alter table public.lab_culls enable row level security;

drop policy if exists lab_culls_owner_select on public.lab_culls;
create policy lab_culls_owner_select on public.lab_culls
  for select to authenticated using (user_id = auth.uid());

drop policy if exists lab_culls_owner_insert on public.lab_culls;
create policy lab_culls_owner_insert on public.lab_culls
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists lab_culls_owner_delete on public.lab_culls;
create policy lab_culls_owner_delete on public.lab_culls
  for delete to authenticated using (user_id = auth.uid());

commit;
