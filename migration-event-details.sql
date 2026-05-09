alter table sessions
add column if not exists event_date date,
add column if not exists start_time time,
add column if not exists price_thb integer check (price_thb is null or price_thb >= 0),
add column if not exists location text,
add column if not exists poster_url text;

update sessions
set
  event_date = coalesce(event_date, date '2026-05-24'),
  start_time = coalesce(start_time, time '09:00'),
  price_thb = coalesce(price_thb, 250),
  location = coalesce(location, 'GDSQ Pickleball')
where title = 'Weekend Social Play';
