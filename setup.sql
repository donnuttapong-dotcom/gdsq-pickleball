-- Run this after creating the tables if you want the frontend sessionId: 1
-- to point to this first event.
insert into sessions (title, max_players, event_date, start_time, price_thb, location)
values ('Weekend Social Play', 24, date '2026-05-24', time '09:00', 250, 'GDSQ Pickleball')
on conflict do nothing;
