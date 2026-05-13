-- Payment catch-up migration for GDSQ Pickleball.
-- Run this once in Supabase SQL Editor if slip upload says:
-- "Payment database setup is missing."

alter table public.sessions
add column if not exists payment_qr_url text,
add column if not exists payment_bank_name text,
add column if not exists payment_account_name text,
add column if not exists payment_account_number text,
add column if not exists payment_promptpay_id text,
add column if not exists payment_mode text not null default 'deposit_then_final',
add column if not exists deposit_amount_thb integer check (deposit_amount_thb is null or deposit_amount_thb >= 0),
add column if not exists estimated_total_thb integer check (estimated_total_thb is null or estimated_total_thb >= 0),
add column if not exists final_amount_thb integer check (final_amount_thb is null or final_amount_thb >= 0),
add column if not exists payment_note_public text;

update public.sessions
set
  payment_mode = coalesce(payment_mode, 'deposit_then_final'),
  deposit_amount_thb = coalesce(deposit_amount_thb, price_thb, 0),
  estimated_total_thb = coalesce(estimated_total_thb, price_thb, 0)
where payment_mode is null
   or deposit_amount_thb is null
   or estimated_total_thb is null;

alter table public.sessions
drop constraint if exists sessions_payment_mode_check;

alter table public.sessions
add constraint sessions_payment_mode_check
check (payment_mode in ('none', 'deposit_then_final', 'final_only'));

alter table public.rsvps
add column if not exists payment_status text not null default 'Pending',
add column if not exists payment_amount_due integer not null default 0 check (payment_amount_due >= 0),
add column if not exists payment_amount_paid integer check (payment_amount_paid is null or payment_amount_paid >= 0),
add column if not exists payment_slip_url text,
add column if not exists payment_slip_path text,
add column if not exists payment_slip_deleted boolean not null default false,
add column if not exists payment_note text,
add column if not exists payment_payer_name text,
add column if not exists payment_submitted_at timestamptz,
add column if not exists payment_paid_at timestamptz,
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

update public.rsvps
set
  payment_status = coalesce(payment_status, 'Pending'),
  final_payment_status = coalesce(final_payment_status, 'NotOpened')
where payment_status is null
   or final_payment_status is null;

alter table public.rsvps
drop constraint if exists rsvps_payment_status_check;

alter table public.rsvps
add constraint rsvps_payment_status_check
check (payment_status in ('Pending', 'Submitted', 'Paid'));

alter table public.rsvps
drop constraint if exists rsvps_final_payment_status_check;

alter table public.rsvps
add constraint rsvps_final_payment_status_check
check (final_payment_status in ('NotOpened', 'Pending', 'Submitted', 'Paid'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

update public.rsvps
set
  payment_slip_url = null,
  final_payment_slip_url = null
where payment_slip_url is not null
   or final_payment_slip_url is not null;

create index if not exists sessions_payment_mode_idx on public.sessions(payment_mode);
create index if not exists rsvps_payment_status_idx on public.rsvps(payment_status);
create index if not exists rsvps_payment_slip_deleted_idx on public.rsvps(payment_slip_deleted);
create index if not exists rsvps_final_payment_status_idx on public.rsvps(final_payment_status);

notify pgrst, 'reload schema';
