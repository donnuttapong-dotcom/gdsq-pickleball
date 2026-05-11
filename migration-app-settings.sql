create table if not exists app_settings (
  key text primary key,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('home_banner_url', '/assets/gdsq-home-banner.png')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('home_banner_slides', '["/assets/gdsq-home-banner.png"]')
on conflict (key) do nothing;

insert into app_settings (key, value)
values (
  'default_event_settings',
  '{"maxPlayers":24,"courtCount":1,"priceThb":250,"location":"","address":"","skillLevel":"","paymentQrUrl":"","paymentBankName":"","paymentAccountName":"","paymentAccountNumber":"","paymentPromptPayId":""}'
)
on conflict (key) do nothing;
