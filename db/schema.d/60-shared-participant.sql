create table if not exists event_registrations(user_id integer not null references users(id) on delete cascade,event_id integer not null references events(id) on delete cascade,ticket_ref text not null unique default gen_random_uuid()::text,primary key(user_id,event_id));
create table if not exists event_teams(id serial primary key,event_id integer not null references events(id) on delete cascade,name text not null,unique(id,event_id));
create unique index if not exists event_teams_name on event_teams(event_id,lower(name));
create table if not exists event_team_members(team_id integer not null,event_id integer not null,user_id integer not null references users(id) on delete cascade,foreign key(team_id,event_id) references event_teams(id,event_id) on delete cascade,primary key(event_id,user_id));
create index if not exists event_registrations_event on event_registrations(event_id);
create index if not exists event_team_members_team on event_team_members(team_id);
