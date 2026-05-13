create table if not exists event_player_votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  voter_user_id uuid not null references users(id) on delete cascade,
  voted_user_id uuid not null references users(id) on delete cascade,
  mvp_score integer not null check (mvp_score between 1 and 5),
  sportsmanship_score integer not null check (sportsmanship_score between 1 and 5),
  teamwork_score integer not null check (teamwork_score between 1 and 5),
  skill_score integer not null check (skill_score between 1 and 5),
  vibes_score integer not null check (vibes_score between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_player_votes_no_self_vote check (voter_user_id <> voted_user_id),
  constraint event_player_votes_one_vote_per_player unique (session_id, voter_user_id, voted_user_id)
);

create index if not exists event_player_votes_session_id_idx
  on event_player_votes(session_id);

create index if not exists event_player_votes_voter_user_id_idx
  on event_player_votes(voter_user_id);

create index if not exists event_player_votes_voted_user_id_idx
  on event_player_votes(voted_user_id);
