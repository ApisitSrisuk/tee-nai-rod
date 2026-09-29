-- Tee Nai Rod — Supabase schema
-- Run once in Supabase Dashboard → SQL Editor → New query → paste all → Run.
--
-- Access model
--   * Anyone (anon key) can READ visible pins directly, including realtime.
--   * Nobody writes with the anon key. All writes go through the Vercel API
--     (/api/pins, /api/vote), which uses the service_role key, checks input,
--     rate-limits by hashed IP and (optionally) verifies Cloudflare Turnstile.
--   * pin_meta and votes hold hashed IPs / tokens and are never readable by anon.

create extension if not exists pgcrypto;

-- ---------- pins: public data ----------
create table if not exists public.pins (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  lat           double precision not null check (lat between 13.4 and 14.0),
  lng           double precision not null check (lng between 100.3 and 101.0),
  district      smallint check (district between 1001 and 1050),
  y54           text not null default 'unk' check (y54 in ('dry','wet','unk')),
  y69           text not null default 'unk' check (y69 in ('dry','wet','unk')),
  note          text not null default '' check (char_length(note) <= 300),
  confirm_count integer not null default 0,
  report_count  integer not null default 0,
  hidden        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists pins_created_idx on public.pins (created_at desc);

-- ---------- pin_meta: private (who created, delete token) ----------
create table if not exists public.pin_meta (
  pin_id      uuid primary key references public.pins(id) on delete cascade,
  ip_hash     text not null,
  token_hash  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists pin_meta_ip_idx on public.pin_meta (ip_hash, created_at desc);

-- ---------- votes: private (one confirm OR report per person per pin) ----------
create table if not exists public.votes (
  pin_id      uuid not null references public.pins(id) on delete cascade,
  voter_hash  text not null,
  kind        text not null check (kind in ('confirm','report')),
  created_at  timestamptz not null default now(),
  primary key (pin_id, voter_hash)
);

-- keep counts on pins in sync; auto-hide pins the community flags as wrong
create or replace function public.apply_vote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.pins p set
    confirm_count = (select count(*) from public.votes v where v.pin_id = p.id and v.kind = 'confirm'),
    report_count  = (select count(*) from public.votes v where v.pin_id = p.id and v.kind = 'report')
  where p.id = coalesce(new.pin_id, old.pin_id);
  update public.pins set hidden = (report_count >= 3 and report_count > confirm_count * 2)
  where id = coalesce(new.pin_id, old.pin_id);
  return null;
end $$;

drop trigger if exists votes_apply on public.votes;
create trigger votes_apply after insert or update or delete on public.votes
for each row execute function public.apply_vote();

-- ---------- Row Level Security ----------
alter table public.pins     enable row level security;
alter table public.pin_meta enable row level security;
alter table public.votes    enable row level security;

drop policy if exists "public reads visible pins" on public.pins;
create policy "public reads visible pins" on public.pins
  for select to anon, authenticated using (hidden = false);
-- no insert/update/delete policies → anon cannot write anything.
-- pin_meta / votes have no policies at all → invisible to anon.

-- ---------- Realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.pins;
exception when duplicate_object then null; end $$;
