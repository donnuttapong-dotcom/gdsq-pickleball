alter table sessions
add column if not exists created_by_user_id uuid references users(id) on delete set null,
add column if not exists status text not null default 'Published' check (status in ('Published', 'Closed', 'Cancelled'));

update sessions
set status = 'Published'
where status is null;

create index if not exists sessions_created_by_user_id_idx on sessions(created_by_user_id);
create index if not exists sessions_status_idx on sessions(status);
