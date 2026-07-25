-- EvoForge 096 — COMMAND: not every change is worth three votes.
--
-- Tyson: "not every feature should require three votes, only changes considered
-- major or major UI changes should require three votes, otherwise it should be
-- one founders approval".
--
-- The council was built on one axis — CATEGORY — and it conflated two different
-- questions: how dangerous is this, and how big is this. Monetisation is
-- dangerous at any size; a copy tweak on the Train screen is neither. With only
-- category to go on, a one-line label fix and a schema migration both sat behind
-- the same quorum, and the predictable result is that voting becomes a formality
-- people click through — which is how a governance system stops governing.
--
-- So significance is its own axis:
--
--   minor  -> ONE founder approves. The fast path for the work that makes up
--             most of a week.
--   major  -> all founders. Anything structural, and anything that visibly
--             changes the app for an athlete.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. Category still wins where it matters:
-- monetisation, ownership and privacy stay unanimous whatever anyone marks them,
-- and security keeps its majority plus a Sentinel pass. 090 forced those to
-- gated deployment for the same reason — a control that any caller can lift is
-- not a control. Significance can only ever make the LOW-RISK case cheaper; it
-- can never make a constitutional one cheaper.
--
-- AND ONE OBJECTION IS ENOUGH TO STOP THE FAST PATH. A minor proposal with any
-- reject against it escalates to a majority. Otherwise "one founder approves"
-- would mean the first founder to click can carry something another has already
-- said no to, and the fast path would quietly become a way around disagreement
-- rather than a way around ceremony.
--
-- FALSIFICATION CHECKLIST:
--   1. minor prototype proposal, one approve -> approved.            [fast path]
--   2. minor proposal with one reject -> needed rises to a majority. [objection]
--   3. monetisation marked minor -> still unanimous.                  [forced]
--   4. set significance on a decided proposal -> refused.               [vote]
--   5. set significance as a non-founder -> refused.                     [RLS]

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE AXIS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_proposals
  add column if not exists significance text not null default 'major';
alter table public.command_backlog
  add column if not exists significance text not null default 'major';

do $$ begin
  alter table public.command_proposals add constraint command_proposals_significance_ck
    check (significance in ('minor','major'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.command_backlog add constraint command_backlog_significance_ck
    check (significance in ('minor','major'));
exception when duplicate_object then null; end $$;

-- Default 'major' on purpose: a column added to live rows must not silently
-- downgrade the quorum on anything already open. New candidates opt IN to the
-- fast path; nothing is opted in for them.
comment on column public.command_proposals.significance is
  'minor = one founder may approve. major = every founder must. Category still '
  'overrides: monetisation/ownership/privacy are unanimous regardless.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE RULE
-- ─────────────────────────────────────────────────────────────────────────────
-- The single-argument form stays, so anything still calling it keeps its old
-- meaning (category-only = the pre-096 behaviour) rather than silently changing.
create or replace function public.command_rule(p_category text, p_significance text)
returns text language sql immutable as $$
  select case
           -- Constitutional, whatever anyone marked it.
           when p_category in ('monetisation','ownership','privacy') then 'unanimous'
           -- Security never takes the fast path; it also carries a Sentinel pass.
           when p_category = 'security' then 'majority'
           when p_significance = 'minor' then 'single'
           else 'unanimous'
         end;
$$;

create or replace function public.command_tally(p_proposal uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cat text; v_sig text; v_total int; a int; r int; c int; ab int;
  v_rule text; v_needed int;
begin
  select category, significance into v_cat, v_sig from command_proposals where id = p_proposal;
  if v_cat is null then return null; end if;
  v_total := command_founder_count();
  v_rule  := command_rule(v_cat, coalesce(v_sig,'major'));

  select count(*) filter (where choice = 'approve'),
         count(*) filter (where choice = 'reject'),
         count(*) filter (where choice = 'request_changes'),
         count(*) filter (where choice = 'abstain')
    into a, r, c, ab
    from command_votes where proposal_id = p_proposal;

  v_needed := case v_rule
                when 'unanimous' then v_total
                when 'single'    then 1
                else (v_total / 2) + 1
              end;

  -- ONE OBJECTION CLOSES THE FAST PATH. Without this, "one founder approves"
  -- lets the first click carry something another founder has already rejected —
  -- the fast path would be a route around disagreement rather than around
  -- ceremony, and that is the failure mode that discredits the whole idea.
  if v_rule = 'single' and r > 0 then
    v_rule := 'majority';
    v_needed := (v_total / 2) + 1;
  end if;

  return jsonb_build_object(
    'rule', v_rule, 'founders', v_total, 'needed', v_needed,
    'significance', coalesce(v_sig,'major'),
    'escalated', (command_rule(v_cat, coalesce(v_sig,'major')) = 'single' and r > 0),
    'approve', a, 'reject', r, 'request_changes', c, 'abstain', ab,
    'cast', a + r + c + ab,
    'approved', a >= v_needed,
    'rejected', (v_total - r) < v_needed
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE FOUNDER OVERRIDE
-- ─────────────────────────────────────────────────────────────────────────────
-- The Exec sets significance when it raises a candidate; a founder may correct
-- it before the vote closes. After that it is part of what people voted on.
create or replace function public.command_set_proposal_significance(p_proposal uuid, p_significance text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; pr record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_significance not in ('minor','major') then
    raise exception 'command: significance must be minor or major';
  end if;
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if pr.status <> 'open' then
    raise exception 'command: % is % — the quorum is part of what the council voted on',
      pr.ref, pr.status;
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_proposals set significance = p_significance where id = p_proposal;

  perform command_log('proposal_significance_set', 'proposal', p_proposal, pr.ref,
                      coalesce(v_name,'a founder') || ' marked ' || pr.ref || ' ' || p_significance ||
                      case when p_significance = 'minor'
                           then ' — one founder may now approve it'
                           else ' — every founder must approve it' end,
                      jsonb_build_object('significance', p_significance,
                                         'category', pr.category));
  return jsonb_build_object('ok', true, 'significance', p_significance);
end $$;
grant execute on function public.command_set_proposal_significance(uuid, text) to authenticated;

-- Carry a candidate's significance through promotion, the same way 095 carries
-- architect authority — and for the same reason: command_create_proposal is
-- 092's, and re-issuing it from an older copy would revert its founder briefs.
create or replace function public.command_carry_significance_to_proposal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.proposal_id is not null
     and new.proposal_id is distinct from old.proposal_id then
    update command_proposals set significance = coalesce(new.significance,'major')
     where id = new.proposal_id;
  end if;
  return new;
end $$;

drop trigger if exists command_backlog_carry_significance on public.command_backlog;
create trigger command_backlog_carry_significance
  after update on public.command_backlog
  for each row execute function public.command_carry_significance_to_proposal();
