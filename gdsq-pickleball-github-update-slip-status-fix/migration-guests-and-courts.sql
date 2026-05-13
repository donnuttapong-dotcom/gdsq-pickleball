alter table sessions
add column if not exists court_count integer not null default 1 check (court_count > 0);

update sessions
set court_count = 1
where court_count is null;

create table if not exists rsvp_guests (
  id uuid primary key default gen_random_uuid(),
  rsvp_id uuid not null references rsvps(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  added_by_user_id uuid not null references users(id) on delete cascade,
  display_name text not null,
  status text not null check (status in ('Joined', 'Waitlist')),
  created_at timestamptz not null default now()
);

create index if not exists rsvp_guests_rsvp_id_idx on rsvp_guests(rsvp_id);
create index if not exists rsvp_guests_session_id_idx on rsvp_guests(session_id);
create index if not exists rsvp_guests_added_by_user_id_idx on rsvp_guests(added_by_user_id);
