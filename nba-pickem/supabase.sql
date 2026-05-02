-- St. G's NBA Pick'em - Supabase schema
-- Paste into the Supabase SQL editor and run.

create table if not exists nba_picks (
  id bigserial primary key,
  player text not null,
  series_id text not null,
  team_key text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player, series_id)
);

create table if not exists nba_series_state (
  series_id text primary key,
  high_wins int default 0,
  low_wins int default 0,
  winner text,
  game1_started boolean default false,
  unlocked boolean default false,
  updated_at timestamptz default now()
);

-- Open RLS for the friend group (anyone with the anon key can read/write).
-- If you want stricter access, add row policies later.
alter table nba_picks enable row level security;
alter table nba_series_state enable row level security;

drop policy if exists "all read picks" on nba_picks;
drop policy if exists "all write picks" on nba_picks;
drop policy if exists "all read state" on nba_series_state;
drop policy if exists "all write state" on nba_series_state;

create policy "all read picks"  on nba_picks            for select using (true);
create policy "all write picks" on nba_picks            for all    using (true) with check (true);
create policy "all read state"  on nba_series_state     for select using (true);
create policy "all write state" on nba_series_state     for all    using (true) with check (true);
