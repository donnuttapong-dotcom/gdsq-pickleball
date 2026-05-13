-- Make payment slips private and serve them through signed URLs only.
-- Uploads still work through the backend because the server uses privileged
-- Supabase credentials; public users should no longer be able to open slip URLs
-- unless the backend explicitly generates a short-lived link for them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

-- Existing public URLs should be cleared. The storage path stays in place so
-- the backend can mint a signed URL whenever an admin or the owner needs it.
update public.rsvps
set
  payment_slip_url = null,
  final_payment_slip_url = null
where payment_slip_url is not null
   or final_payment_slip_url is not null;
