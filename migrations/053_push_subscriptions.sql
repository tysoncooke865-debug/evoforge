-- EvoForge 053 — WEB PUSH subscriptions (Tyson, 2026-07-19).
--
-- The app ships as an installed PWA (iOS 16.4+ supports Web Push for
-- home-screen apps), so real phone push = the Push API: a service worker
-- subscription (endpoint + p256dh + auth) stored per user, and an edge
-- function (send-push) that VAPID-signs + encrypts a payload to those
-- endpoints. Owner-only RLS; the sender reads via the service role.

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
