-- Increase private payment slip upload limit for mobile camera screenshots.
-- Keep the bucket private; this only changes the maximum file size.

update storage.buckets
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'payment-slips';
