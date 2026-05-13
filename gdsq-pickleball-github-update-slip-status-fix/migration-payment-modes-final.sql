alter table sessions
add column if not exists payment_mode text not null default 'deposit_then_final',
add column if not exists deposit_amount_thb integer check (deposit_amount_thb is null or deposit_amount_thb >= 0),
add column if not exists estimated_total_thb integer check (estimated_total_thb is null or estimated_total_thb >= 0),
add column if not exists final_amount_thb integer check (final_amount_thb is null or final_amount_thb >= 0),
add column if not exists payment_note_public text;

update sessions
set
  payment_mode = coalesce(payment_mode, 'deposit_then_final'),
  deposit_amount_thb = coalesce(deposit_amount_thb, price_thb, 0),
  estimated_total_thb = coalesce(estimated_total_thb, price_thb, 0)
where payment_mode is null
   or deposit_amount_thb is null
   or estimated_total_thb is null;

alter table sessions
drop constraint if exists sessions_payment_mode_check;

alter table sessions
add constraint sessions_payment_mode_check
check (payment_mode in ('none', 'deposit_then_final', 'final_only'));

alter table rsvps
add column if not exists final_payment_status text not null default 'NotOpened',
add column if not exists final_payment_amount_due integer not null default 0 check (final_payment_amount_due >= 0),
add column if not exists final_payment_amount_paid integer check (final_payment_amount_paid is null or final_payment_amount_paid >= 0),
add column if not exists final_payment_slip_url text,
add column if not exists final_payment_slip_path text,
add column if not exists final_payment_note text,
add column if not exists final_payment_payer_name text,
add column if not exists final_payment_submitted_at timestamptz,
add column if not exists final_payment_paid_at timestamptz,
add column if not exists admin_payment_note text;

alter table rsvps
drop constraint if exists rsvps_final_payment_status_check;

alter table rsvps
add constraint rsvps_final_payment_status_check
check (final_payment_status in ('NotOpened', 'Pending', 'Submitted', 'Paid'));

create index if not exists sessions_payment_mode_idx on sessions(payment_mode);
create index if not exists rsvps_final_payment_status_idx on rsvps(final_payment_status);
