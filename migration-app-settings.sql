create table if not exists app_settings (
  key text primary key,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('home_banner_url', '/assets/gdsq-home-banner.png')
on conflict (key) do nothing;
