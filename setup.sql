-- Run this after creating the tables if you want the frontend sessionId: 1
-- to point to this first event.
insert into sessions (title, max_players)
values ('Weekend Social Play', 24)
on conflict do nothing;
