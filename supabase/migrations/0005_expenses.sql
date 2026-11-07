-- Shared trip expenses with per-expense participants (equal split among participants).
-- A "transfer" is a settlement payment: paid_by pays the single participant.

alter table public.trips
  add column if not exists currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$');

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 160),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  category     text not null default 'other'
               check (category in ('stay', 'food', 'transport', 'tickets', 'activity', 'shopping', 'other')),
  kind         text not null default 'expense' check (kind in ('expense', 'transfer')),
  paid_by      uuid not null references auth.users (id) on delete cascade,
  spent_on     date not null default current_date,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, trip_id)
);
create index expenses_trip_idx on public.expenses (trip_id);

create table public.expense_participants (
  expense_id uuid not null,
  trip_id    uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  primary key (expense_id, user_id),
  foreign key (expense_id, trip_id) references public.expenses (id, trip_id) on delete cascade
);
create index expense_participants_trip_idx on public.expense_participants (trip_id);

create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();

-- Who may change/delete an expense: whoever created it, whoever paid, or the trip owner
create or replace function public.can_edit_expense(p_expense uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from expenses e
    where e.id = p_expense
      and public.is_trip_member(e.trip_id)
      and (e.created_by = auth.uid() or e.paid_by = auth.uid() or public.is_trip_owner(e.trip_id))
  );
$$;

-- Create (p_id null) or update an expense together with its participants, atomically.
create or replace function public.save_expense(
  p_id uuid, p_trip uuid, p_title text, p_amount_cents integer, p_category text, p_kind text,
  p_paid_by uuid, p_spent_on date, p_participants uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  e_id uuid;
begin
  if not public.is_trip_member(p_trip) then raise exception 'not a member of this trip'; end if;
  if not exists (select 1 from trip_members where trip_id = p_trip and user_id = p_paid_by) then
    raise exception 'payer is not a member of this trip';
  end if;
  if coalesce(array_length(p_participants, 1), 0) = 0 then
    raise exception 'at least one participant is required';
  end if;
  if exists (
    select 1 from unnest(p_participants) u(uid)
    where not exists (select 1 from trip_members m where m.trip_id = p_trip and m.user_id = u.uid)
  ) then
    raise exception 'participants must be members of this trip';
  end if;

  if p_id is null then
    insert into expenses (trip_id, title, amount_cents, category, kind, paid_by, spent_on, created_by)
    values (p_trip, p_title, p_amount_cents, p_category, p_kind, p_paid_by, coalesce(p_spent_on, current_date), auth.uid())
    returning id into e_id;
  else
    if not public.can_edit_expense(p_id) then raise exception 'not allowed to edit this expense'; end if;
    update expenses
       set title = p_title, amount_cents = p_amount_cents, category = p_category, kind = p_kind,
           paid_by = p_paid_by, spent_on = coalesce(p_spent_on, spent_on)
     where id = p_id and trip_id = p_trip
    returning id into e_id;
    if e_id is null then raise exception 'expense not found'; end if;
    delete from expense_participants where expense_id = e_id;
  end if;

  insert into expense_participants (expense_id, trip_id, user_id)
  select e_id, p_trip, uid from (select distinct unnest(p_participants) as uid) s;
  return e_id;
end $$;

revoke execute on function public.save_expense, public.can_edit_expense from public, anon;
grant execute on function public.save_expense, public.can_edit_expense to authenticated;

alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;

create policy expenses_select on public.expenses for select to authenticated
  using (public.is_trip_member(trip_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.can_edit_expense(id));
create policy expense_participants_select on public.expense_participants for select to authenticated
  using (public.is_trip_member(trip_id));

-- writes go through save_expense(); deleting an expense cascades to its participants
grant select, delete on public.expenses to authenticated;
grant select on public.expense_participants to authenticated;

alter publication supabase_realtime add table public.expenses, public.expense_participants;
