alter table sessions
add column if not exists payment_qr_url text,
add column if not exists payment_bank_name text,
add column if not exists payment_account_name text,
add column if not exists payment_account_number text,
add column if not exists payment_promptpay_id text;

alter table rsvps
add column if not exists payment_status text not null default 'Pending' check (payment_status in ('Pending', 'Submitted', 'Paid')),
add column if not exists payment_amount_due integer not null default 0 check (payment_amount_due >= 0),
add column if not exists payment_amount_paid integer check (payment_amount_paid is null or payment_amount_paid >= 0),
add column if not exists payment_slip_url text,
add column if not exists payment_slip_path text,
add column if not exists payment_slip_deleted boolean not null default false,
add column if not exists payment_note text,
add column if not exists payment_payer_name text,
add column if not exists payment_submitted_at timestamptz,
add column if not exists payment_paid_at timestamptz;

update rsvps
set payment_status = 'Pending'
where payment_status is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

create index if not exists rsvps_payment_status_idx on rsvps(payment_status);
create index if not exists rsvps_payment_slip_deleted_idx on rsvps(payment_slip_deleted);
