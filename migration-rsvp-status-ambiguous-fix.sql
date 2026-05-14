-- RSVP protection: prevent duplicate RSVP rows per user + session
-- and reserve seats atomically to avoid oversell when users join together.
--
-- If the unique index fails to create, first check whether duplicate rows
-- already exist with:
-- select session_id, user_id, count(*)
-- from rsvps
-- group by session_id, user_id
-- having count(*) > 1;

create unique index if not exists rsvps_session_user_unique_idx
  on public.rsvps (session_id, user_id);

create or replace function public.reserve_session_rsvp(
  p_session_id uuid,
  p_user_id uuid,
  p_guest_names text[] default '{}'
)
returns table (
  rsvp_id uuid,
  status text,
  reservation_joined_count integer,
  reservation_waitlist_count integer,
  guest_count integer,
  already_exists boolean
)
language plpgsql
as $$
declare
  v_session public.sessions%rowtype;
  v_existing public.rsvps%rowtype;
  v_joined_seats integer := 0;
  v_max_players integer := 0;
  v_guest_name text;
  v_status text;
  v_rsvp_id uuid;
  v_joined_count integer := 0;
  v_waitlist_count integer := 0;
  v_guest_total integer := 0;
begin
  select *
  into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found.';
  end if;

  v_max_players := greatest(coalesce(v_session.max_players, 0), 0);

  select *
  into v_existing
  from public.rsvps
  where rsvps.session_id = p_session_id
    and rsvps.user_id = p_user_id;

  if found then
    return query
    select
      v_existing.id,
      v_existing.status,
      (case when v_existing.status = 'Joined' then 1 else 0 end)
        + coalesce((
          select count(*)::integer
          from public.rsvp_guests rg
          where rg.rsvp_id = v_existing.id
            and rg.status = 'Joined'
        ), 0),
      (case when v_existing.status = 'Waitlist' then 1 else 0 end)
        + coalesce((
          select count(*)::integer
          from public.rsvp_guests rg
          where rg.rsvp_id = v_existing.id
            and rg.status = 'Waitlist'
        ), 0),
      coalesce((
        select count(*)::integer
        from public.rsvp_guests rg
        where rg.rsvp_id = v_existing.id
      ), 0),
      true;
    return;
  end if;

  select
    coalesce((
      select count(*)::integer
      from public.rsvps r
      where r.session_id = p_session_id
        and r.status = 'Joined'
    ), 0)
    + coalesce((
      select count(*)::integer
      from public.rsvp_guests rg
      where rg.session_id = p_session_id
        and rg.status = 'Joined'
    ), 0)
  into v_joined_seats;

  if v_joined_seats < v_max_players then
    v_status := 'Joined';
    v_joined_seats := v_joined_seats + 1;
    v_joined_count := 1;
  else
    v_status := 'Waitlist';
    v_waitlist_count := 1;
  end if;

  insert into public.rsvps (
    session_id,
    user_id,
    status
  )
  values (
    p_session_id,
    p_user_id,
    v_status
  )
  returning id into v_rsvp_id;

  if coalesce(array_length(p_guest_names, 1), 0) > 0 then
    foreach v_guest_name in array p_guest_names loop
      v_guest_name := trim(coalesce(v_guest_name, ''));
      if v_guest_name = '' then
        continue;
      end if;

      v_guest_total := v_guest_total + 1;

      if v_joined_seats < v_max_players then
        insert into public.rsvp_guests (
          rsvp_id,
          session_id,
          added_by_user_id,
          display_name,
          status
        )
        values (
          v_rsvp_id,
          p_session_id,
          p_user_id,
          v_guest_name,
          'Joined'
        );

        v_joined_seats := v_joined_seats + 1;
        v_joined_count := v_joined_count + 1;
      else
        insert into public.rsvp_guests (
          rsvp_id,
          session_id,
          added_by_user_id,
          display_name,
          status
        )
        values (
          v_rsvp_id,
          p_session_id,
          p_user_id,
          v_guest_name,
          'Waitlist'
        );

        v_waitlist_count := v_waitlist_count + 1;
      end if;
    end loop;
  end if;

  return query
  select
    v_rsvp_id,
    v_status,
    v_joined_count,
    v_waitlist_count,
    v_guest_total,
    false;
exception
  when unique_violation then
    select *
    into v_existing
    from public.rsvps
    where rsvps.session_id = p_session_id
      and rsvps.user_id = p_user_id;

    if found then
      return query
      select
        v_existing.id,
        v_existing.status,
        (case when v_existing.status = 'Joined' then 1 else 0 end)
          + coalesce((
            select count(*)::integer
            from public.rsvp_guests rg
            where rg.rsvp_id = v_existing.id
              and rg.status = 'Joined'
          ), 0),
        (case when v_existing.status = 'Waitlist' then 1 else 0 end)
          + coalesce((
            select count(*)::integer
            from public.rsvp_guests rg
            where rg.rsvp_id = v_existing.id
              and rg.status = 'Waitlist'
          ), 0),
        coalesce((
          select count(*)::integer
          from public.rsvp_guests rg
          where rg.rsvp_id = v_existing.id
        ), 0),
        true;
      return;
    end if;

    raise;
end;
$$;
