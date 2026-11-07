-- Generated route per trip (latest one wins). Visible to all members.

create table public.trip_routes (
  trip_id    uuid primary key references public.trips (id) on delete cascade,
  params     jsonb not null,
  plan       jsonb not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.trip_routes enable row level security;

create policy routes_select on public.trip_routes for select to authenticated
  using (public.is_trip_member(trip_id));
create policy routes_insert on public.trip_routes for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy routes_update on public.trip_routes for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy routes_delete on public.trip_routes for delete to authenticated
  using (public.is_trip_owner(trip_id));

grant select, insert, update, delete on public.trip_routes to authenticated;

alter publication supabase_realtime add table public.trip_routes;
