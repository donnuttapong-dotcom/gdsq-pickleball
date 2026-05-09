-- Run this after creating the tables if you want the frontend sessionId: 1
-- to point to this first event.
insert into sessions (title, max_players, event_date, start_time, end_time, price_thb, location, address, skill_level, description, poster_url)
values (
  'Weekend Social Play',
  24,
  date '2026-05-24',
  time '09:00',
  time '11:00',
  250,
  'GDSQ Pickleball',
  'Bangkok, Thailand',
  'Intermediate',
  'Join us for a fun and friendly pickleball session. Good rallies, good people, and great vibes.',
  null
)
on conflict do nothing;
