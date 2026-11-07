-- Tripboard: initial schema
-- Run in the Supabase SQL editor (or via `supabase db push`).
-- Requires: Authentication -> Providers -> "Anonymous sign-ins" enabled.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.idea_category as enum ('sight', 'hike', 'nature', 'food', 'activity', 'stay');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  region      text check (char_length(region) <= 120),
  start_date  date,
  days        int check (days between 1 and 60),
  center_lng  double precision not null default -4.5,
  center_lat  double precision not null default 57.2,
  zoom        double precision not null default 6,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.trip_members (
  trip_id      uuid not null references public.trips (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  color        text not null,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);

create table public.ideas (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 160),
  note         text check (char_length(note) <= 4000),
  url          text check (char_length(url) <= 2000),
  category     public.idea_category not null default 'sight',
  lng          double precision not null check (lng between -180 and 180),
  lat          double precision not null check (lat between -90 and 90),
  location     extensions.geography(Point, 4326)
               generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  duration_min int check (duration_min between 0 and 10080),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, trip_id)
);
create index ideas_trip_idx on public.ideas (trip_id);
create index ideas_location_idx on public.ideas using gist (location);

create table public.votes (
  idea_id    uuid not null,
  trip_id    uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  value      smallint not null check (value in (-1, 1, 2)), -- -1 = nope, 1 = like, 2 = must-do
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id),
  foreign key (idea_id, trip_id) references public.ideas (id, trip_id) on delete cascade
);
create index votes_trip_idx on public.votes (trip_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = p_trip and user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = p_trip and user_id = auth.uid() and role = 'owner');
$$;

-- Keep in sync with app/lib/colors.ts
create or replace function public.member_color(n int)
returns text language sql immutable as $$
  select (array['#e4572e','#2e86ab','#76b041','#a23b72','#f1a208','#6c4ab6','#17a398','#c44569'])[(n % 8) + 1];
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger ideas_touch before update on public.ideas
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_trip(
  p_name text, p_region text, p_start_date date, p_days int,
  p_center_lng double precision, p_center_lat double precision, p_zoom double precision,
  p_display_name text
) returns public.trips language plpgsql security definer set search_path = public as $$
declare
  t trips;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into trips (name, region, start_date, days, center_lng, center_lat, zoom, created_by)
  values (p_name, p_region, p_start_date, p_days, p_center_lng, p_center_lat, p_zoom, auth.uid())
  returning * into t;
  insert into trip_members (trip_id, user_id, display_name, color, role)
  values (t.id, auth.uid(), p_display_name, member_color(0), 'owner');
  return t;
end $$;

create or replace function public.trip_preview(p_code text)
returns table (id uuid, name text, region text) language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.region from trips t where t.invite_code = p_code;
$$;

create or replace function public.join_trip(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into t_id from trips where invite_code = p_code;
  if t_id is null then raise exception 'invalid invite code'; end if;
  if exists (select 1 from trip_members where trip_id = t_id and user_id = auth.uid()) then
    return t_id;
  end if;
  select count(*) into n from trip_members where trip_id = t_id;
  insert into trip_members (trip_id, user_id, display_name, color, role)
  values (t_id, auth.uid(), p_display_name, member_color(n), 'member');
  return t_id;
end $$;

revoke execute on function public.create_trip, public.trip_preview, public.join_trip from public, anon;
grant execute on function public.create_trip, public.trip_preview, public.join_trip to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.ideas enable row level security;
alter table public.votes enable row level security;

-- trips (insert only via create_trip)
create policy trips_select on public.trips for select to authenticated using (public.is_trip_member(id));
create policy trips_update on public.trips for update to authenticated using (public.is_trip_owner(id));
create policy trips_delete on public.trips for delete to authenticated using (public.is_trip_owner(id));

-- trip_members (insert only via create_trip / join_trip)
create policy members_select on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy members_update_self on public.trip_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_leave on public.trip_members for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- ideas
create policy ideas_select on public.ideas for select to authenticated using (public.is_trip_member(trip_id));
create policy ideas_insert on public.ideas for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy ideas_update on public.ideas for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy ideas_delete on public.ideas for delete to authenticated
  using (created_by = auth.uid() or public.is_trip_owner(trip_id));

-- votes
create policy votes_select on public.votes for select to authenticated using (public.is_trip_member(trip_id));
create policy votes_insert on public.votes for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy votes_update on public.votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy votes_delete on public.votes for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.ideas, public.votes, public.trip_members;
