-- Only registered accounts (e-mail or Google) may see or change anything.
-- Anonymous Supabase sessions are rejected even if "Allow anonymous sign-ins" is switched on.

create or replace function public.is_registered()
returns boolean language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_registered()
     and exists (select 1 from trip_members where trip_id = p_trip and user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_registered()
     and exists (select 1 from trip_members where trip_id = p_trip and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.create_trip(
  p_name text, p_region text, p_start_date date, p_days int,
  p_center_lng double precision, p_center_lat double precision, p_zoom double precision,
  p_display_name text
) returns public.trips language plpgsql security definer set search_path = public as $$
declare
  t trips;
begin
  if not public.is_registered() then raise exception 'registration required'; end if;
  insert into trips (name, region, start_date, days, center_lng, center_lat, zoom, created_by)
  values (p_name, p_region, p_start_date, p_days, p_center_lng, p_center_lat, p_zoom, auth.uid())
  returning * into t;
  insert into trip_members (trip_id, user_id, display_name, color, role)
  values (t.id, auth.uid(), p_display_name, member_color(0), 'owner');
  return t;
end $$;

create or replace function public.trip_preview(p_code text)
returns table (id uuid, name text, region text) language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.region from trips t
  where t.invite_code = p_code and public.is_registered();
$$;

create or replace function public.join_trip(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  n int;
begin
  if not public.is_registered() then raise exception 'registration required'; end if;
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

revoke execute on function public.is_registered() from public, anon;
grant execute on function public.is_registered() to authenticated;
