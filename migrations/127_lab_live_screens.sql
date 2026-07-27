-- EvoForge 127 — the Dev Lab shows the app, not a drawing of the app.
--
-- Until now, opening a screen in the lab showed a RECONSTRUCTION: a model read
-- the React Native source and rebuilt the screen in HTML. It was labelled
-- honestly as a reconstruction, and it was still the wrong thing. A founder
-- looking at a screen to decide whether a button is in the right place needs
-- the button that ships, at the size it ships, with the content it actually
-- has.
--
-- The only reason it worked that way is that every route on the deployed build
-- redirects to /sign-in without a session, so nothing could be photographed.
-- That is now solved with a dedicated lab account (registered in
-- command_synthetic_accounts by 126, so it cannot move a product metric).
--
-- WHAT THIS ADDS
--
--   'shoot' — a job kind that signs in once and photographs real routes.
--   command_lab_screens — what the lab knows about each real screen: the route,
--     the newest photograph, and whether the last attempt actually landed there.
--   command_lab_screen_record() — records one attempt, success or bounce.
--
-- A BOUNCE IS RECORDED, NOT DISCARDED. The single worst bug this system has had
-- was a capture of the sign-in page stored as "Home — captured": convincing,
-- wrong, and invisible. Every attempt records the path asked for and the path
-- landed on, and a row where those differ can never be displayed as the screen.

alter table public.command_lab_jobs drop constraint if exists command_lab_jobs_kind_check;
alter table public.command_lab_jobs add constraint command_lab_jobs_kind_check
  check (kind in ('bench','judge','capture','perf','generate','simulate','arena','predict',
                  'import','edit','transcribe','research','suggest','shoot'));

create table if not exists public.command_lab_screens (
  subject_key   text primary key references public.command_lab_subjects(key) on delete cascade,
  route         text not null,
  -- The path the browser actually ended on. When it differs from `route` the
  -- photograph is of somewhere else, and status says so.
  landed_path   text,
  status        text not null default 'unknown'
                check (status in ('unknown','captured','bounced','error','skipped')),
  detail        text,
  storage_path  text,
  width         int,
  height        int,
  bytes         int,
  shot_at       timestamptz,
  attempts      int not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.command_lab_screens enable row level security;
drop policy if exists command_lab_screens_read on public.command_lab_screens;
create policy command_lab_screens_read on public.command_lab_screens
  for select using (is_founder());

comment on table public.command_lab_screens is
  'One row per real EvoForge route: where the lab last photographed it, and whether it landed on the right screen.';

-- A photograph can only be shown as the screen when the browser landed on it.
-- Expressed as a constraint rather than as a convention, because the convention
-- is what failed last time.
alter table public.command_lab_screens drop constraint if exists command_lab_screens_capture_landed;
alter table public.command_lab_screens add constraint command_lab_screens_capture_landed
  check (status <> 'captured' or (storage_path is not null and landed_path is not null));

create or replace function public.command_lab_screen_record(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_key text; v_route text; v_landed text;
begin
  v_key := p->>'subject_key';
  v_route := p->>'route';
  if v_key is null or v_route is null then
    raise exception 'command: a screen record needs a subject_key and a route';
  end if;
  if not exists (select 1 from command_lab_subjects where key = v_key) then
    raise exception 'command: no lab subject %', v_key;
  end if;

  v_landed := nullif(p->>'landed_path', '');
  v_status := coalesce(p->>'status', 'unknown');

  -- THE CHECK THAT MATTERS. A caller claiming success while the browser ended
  -- somewhere else is refused here rather than trusted, because the caller is
  -- the thing that got it wrong last time.
  if v_status = 'captured' and (v_landed is distinct from v_route) then
    raise exception 'command: % was asked for and % was reached — that photograph is of a different screen',
      v_route, coalesce(v_landed, 'nowhere');
  end if;

  insert into command_lab_screens (subject_key, route, landed_path, status, detail,
                                   storage_path, width, height, bytes, shot_at, attempts)
  values (v_key, v_route, v_landed, v_status, left(coalesce(p->>'detail',''), 500),
          nullif(p->>'storage_path',''),
          (p->>'width')::int, (p->>'height')::int, (p->>'bytes')::int,
          case when v_status = 'captured' then now() else null end,
          1)
  on conflict (subject_key) do update set
    route = excluded.route,
    landed_path = excluded.landed_path,
    status = excluded.status,
    detail = excluded.detail,
    -- A failed attempt does NOT erase the last good photograph. Yesterday's
    -- real screen beats today's blank one, and the status says which it is.
    storage_path = coalesce(excluded.storage_path, command_lab_screens.storage_path),
    width  = coalesce(excluded.width,  command_lab_screens.width),
    height = coalesce(excluded.height, command_lab_screens.height),
    bytes  = coalesce(excluded.bytes,  command_lab_screens.bytes),
    shot_at = coalesce(excluded.shot_at, command_lab_screens.shot_at),
    attempts = command_lab_screens.attempts + 1,
    updated_at = now();

  return jsonb_build_object('ok', true, 'subject_key', v_key, 'status', v_status);
end $$;

revoke all on function public.command_lab_screen_record(jsonb) from public, anon;
grant execute on function public.command_lab_screen_record(jsonb) to authenticated;

-- What the lab UI reads: every subject that maps to a real route, with its
-- photograph and an honest word for what is being shown.
create or replace function public.command_lab_screen_board()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'label'), '[]'::jsonb) from (
    select jsonb_build_object(
      'subject_key', s.key,
      'label', s.label,
      'surface', s.surface,
      'route', sc.route,
      'status', coalesce(sc.status, 'unknown'),
      'landed_path', sc.landed_path,
      'storage_path', sc.storage_path,
      'width', sc.width,
      'height', sc.height,
      'shot_at', sc.shot_at,
      'attempts', coalesce(sc.attempts, 0),
      'detail', sc.detail,
      'showing', case
        when sc.status = 'captured' then 'the running app'
        when sc.status = 'bounced'  then 'nothing — the app redirected away from this route'
        when sc.status = 'error'    then 'nothing — the attempt failed'
        when sc.storage_path is not null then 'an older photograph'
        else 'nothing yet'
      end
    ) x
    from command_lab_subjects s
    left join command_lab_screens sc on sc.subject_key = s.key
    where s.kind = 'screen' and s.surface is not null
  ) t;
$$;

revoke all on function public.command_lab_screen_board() from public, anon;
grant execute on function public.command_lab_screen_board() to authenticated;
