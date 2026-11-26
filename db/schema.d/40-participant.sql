create table if not exists participant_events (id integer primary key, title text not null, category text not null, date timestamptz not null, location text not null, image text not null, description text not null, capacity integer not null check(capacity>0));
create table if not exists participant_registrations (user_id integer references users(id) on delete cascade, event_id integer references participant_events(id) on delete cascade, primary key(user_id,event_id));
create table if not exists participant_teams (id serial primary key, name text not null, event_id integer not null references participant_events(id));
create unique index if not exists participant_team_name on participant_teams(lower(name));
create table if not exists participant_members (team_id integer references participant_teams(id) on delete cascade, user_id integer references users(id) on delete cascade, primary key(team_id,user_id));
create table if not exists participant_announcements (id serial primary key, title text not null, body text not null, created_at timestamptz not null default now());
