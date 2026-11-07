-- Explicit table/function privileges.
-- Newer Supabase projects no longer grant access to new tables in `public`
-- automatically. RLS policies (0001) still decide which rows are visible.

grant usage on schema public to authenticated;

-- trips / trip_members are created only via create_trip / join_trip (RPC)
grant select, update, delete on public.trips to authenticated;
grant select, update, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.ideas to authenticated;
grant select, insert, update, delete on public.votes to authenticated;

-- helpers used inside RLS policies
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_owner(uuid) to authenticated;
