alter table sessions
add column if not exists event_date date,
add column if not exists start_time time,
add column if not exists end_time time,
add column if not exists price_thb integer check (price_thb is null or price_thb >= 0),
add column if not exists location text,
add column if not exists address text,
add column if not exists skill_level text,
add column if not exists description text,
add column if not exists poster_url text;

update sessions
set
  event_date = coalesce(event_date, date '2026-05-24'),
  start_time = coalesce(start_time, time '09:00'),
  end_time = coalesce(end_time, time '11:00'),
  price_thb = coalesce(price_thb, 250),
  location = coalesce(location, 'GDSQ Pickleball'),
  address = coalesce(address, 'Bangkok, Thailand'),
  skill_level = coalesce(skill_level, 'Intermediate'),
  description = coalesce(description, 'Join us for a fun and friendly pickleball session. Good rallies, good people, and great vibes.')
where title = 'Weekend Social Play';
