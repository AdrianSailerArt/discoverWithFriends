-- Shared packing list, bookings (accommodation, ferries, tickets …) and uploaded confirmations.
-- Every member of a trip may read and change all of it – it's a shared trip folder.

-- --- packing list -------------------------------------------------------------------
create table public.packing_items (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  category    text not null default 'other'
              check (category in ('docs', 'clothes', 'hygiene', 'health', 'tech', 'gear', 'food', 'other')),
  quantity    integer not null default 1 check (quantity between 1 and 99),
  assigned_to uuid references auth.users (id) on delete set null,
  packed      boolean not null default false,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index packing_items_trip_idx on public.packing_items (trip_id);

-- the person bringing an item must be part of the trip
create or replace function public.is_member_of(p_trip uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is null or exists (select 1 from trip_members where trip_id = p_trip and user_id = p_user);
$$;
revoke execute on function public.is_member_of from public, anon;
grant execute on function public.is_member_of to authenticated;

alter table public.packing_items enable row level security;
create policy packing_select on public.packing_items for select to authenticated
  using (public.is_trip_member(trip_id));
create policy packing_insert on public.packing_items for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id) and public.is_member_of(trip_id, assigned_to));
create policy packing_update on public.packing_items for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id) and public.is_member_of(trip_id, assigned_to));
create policy packing_delete on public.packing_items for delete to authenticated
  using (public.is_trip_member(trip_id));
grant select, insert, update, delete on public.packing_items to authenticated;

-- --- bookings ---------------------------------------------------------------------------
create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id) on delete cascade,
  kind              text not null default 'stay' check (kind in ('stay', 'transport', 'activity', 'other')),
  title             text not null check (char_length(title) between 1 and 160),
  starts_on         date not null,
  start_time        time,
  ends_on           date check (ends_on is null or ends_on >= starts_on),
  end_time          time,
  address           text check (char_length(address) <= 300),
  lng               double precision check (lng between -180 and 180),
  lat               double precision check (lat between -90 and 90),
  confirmation_code text check (char_length(confirmation_code) <= 80),
  url               text check (char_length(url) <= 2000),
  note              text check (char_length(note) <= 2000),
  created_by        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, trip_id)
);
create index bookings_trip_idx on public.bookings (trip_id);
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

create table public.booking_files (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null,
  trip_id     uuid not null,
  name        text not null check (char_length(name) between 1 and 255),
  path        text not null unique,
  size_bytes  integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime        text not null,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  foreign key (booking_id, trip_id) references public.bookings (id, trip_id) on delete cascade,
  -- the file must live in the trip's folder
  check (split_part(path, '/', 1) = trip_id::text and split_part(path, '/', 2) = booking_id::text)
);
create index booking_files_trip_idx on public.booking_files (trip_id);

alter table public.bookings enable row level security;
alter table public.booking_files enable row level security;

create policy bookings_select on public.bookings for select to authenticated
  using (public.is_trip_member(trip_id));
create policy bookings_insert on public.bookings for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy bookings_update on public.bookings for update to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy bookings_delete on public.bookings for delete to authenticated
  using (public.is_trip_member(trip_id));

create policy booking_files_select on public.booking_files for select to authenticated
  using (public.is_trip_member(trip_id));
create policy booking_files_insert on public.booking_files for insert to authenticated
  with check (created_by = auth.uid() and public.is_trip_member(trip_id));
create policy booking_files_delete on public.booking_files for delete to authenticated
  using (public.is_trip_member(trip_id));

grant select, insert, update, delete on public.bookings to authenticated;
grant select, insert, delete on public.booking_files to authenticated;

-- --- storage: private bucket, one folder per trip ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-files', 'booking-files', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'text/plain', 'message/rfc822']
)
on conflict (id) do nothing;

-- folder names that are not a uuid must not raise an error inside a policy
create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create policy booking_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'booking-files' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy booking_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'booking-files' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));
create policy booking_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'booking-files' and public.is_trip_member(public.try_uuid((storage.foldername(name))[1])));

alter publication supabase_realtime add table public.packing_items, public.bookings, public.booking_files;
