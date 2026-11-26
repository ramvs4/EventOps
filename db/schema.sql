-- Tables for EventOps. Safe to run more than once (nothing is deleted).

create table if not exists events (
  id          serial primary key,
  name        text not null,
  starts_at   timestamptz not null,
  created_at  timestamptz not null default now()
);
-- Added after the first connection test, so it is added separately.
alter table events add column if not exists issues_resolved_before integer not null default 18;

create table if not exists tasks (
  id          serial primary key,
  event_id    integer not null references events(id) on delete cascade,
  title       text not null,
  owner       text not null default 'You',
  due         date,
  priority    text not null check (priority in ('High', 'Medium', 'Low')),
  status      text not null default 'Backlog' check (status in ('Backlog', 'In Progress', 'Blocked', 'Done')),
  created_at  timestamptz not null default now()
);

create table if not exists resources (
  id          serial primary key,
  event_id    integer not null references events(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('venue', 'gear')),
  slot        text not null,
  status      text not null check (status in ('Booked', 'Pending', 'Conflict', 'Free'))
);

create table if not exists issues (
  id           serial primary key,
  event_id     integer not null references events(id) on delete cascade,
  title        text not null,
  severity     text not null check (severity in ('Critical', 'High', 'Medium', 'Low')),
  status       text not null default 'Open' check (status in ('Open', 'Resolved')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- A budget category has a planned amount; what has been spent is the total of its expenses.
create table if not exists budget_categories (
  id              serial primary key,
  event_id        integer not null references events(id) on delete cascade,
  head            text not null,
  planned_amount  integer not null check (planned_amount >= 0)
);

create table if not exists expenses (
  id           serial primary key,
  category_id  integer not null references budget_categories(id) on delete cascade,
  amount       integer not null check (amount > 0),
  note         text not null default '',
  spent_on     date not null default current_date,
  created_at   timestamptz not null default now()
);

create table if not exists sponsors (
  id        serial primary key,
  event_id  integer not null references events(id) on delete cascade,
  name      text not null,
  amount    integer not null check (amount >= 0),
  status    text not null check (status in ('Paid', 'Pending')),
  note      text not null default ''
);

create table if not exists schedule_items (
  id         serial primary key,
  event_id   integer not null references events(id) on delete cascade,
  title      text not null,
  venue      text not null,
  starts_at  timestamptz not null
);

create table if not exists activity (
  id          serial primary key,
  event_id    integer not null references events(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now()
);

-- ---- Accounts and sign-in (Step 5C) ----
-- Passwords are never stored. password_hash holds a salted scrypt hash.
-- Emails are stored in lower case. reset.sql does NOT touch these two tables.
create table if not exists users (
  id             serial primary key,
  name           text not null,
  email          text not null unique,
  password_hash  text not null,
  role           text not null check (role in ('admin', 'volunteer', 'participant')),
  failed_logins  integer not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now()
);

-- A session is one signed-in browser. The cookie holds a random token; only its hash is stored here.
create table if not exists sessions (
  token_hash  text primary key,
  user_id     integer not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- ---- Volunteer work (Step 5C, part 2) ----
-- A task can be assigned to a volunteer account. `owner` keeps showing that person's name on the admin board.
-- `note` holds the volunteer's reason while a task is Blocked. `updated_at` shows when a status last changed.
alter table tasks add column if not exists assignee_id integer references users(id) on delete set null;
alter table tasks add column if not exists note        text not null default '';
alter table tasks add column if not exists updated_at  timestamptz not null default now();
create index if not exists tasks_assignee_idx on tasks (assignee_id);

-- ---- Volunteer extras (Step 5C, part 3) ----
-- Shifts: a volunteer checks in when they arrive and out when they leave.
-- The partial unique index allows only ONE open shift per volunteer, even if two taps arrive together.
create table if not exists shifts (
  id             serial primary key,
  user_id        integer not null references users(id) on delete cascade,
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz
);
create index if not exists shifts_user_idx on shifts (user_id, checked_in_at desc);
create unique index if not exists shifts_one_open on shifts (user_id) where checked_out_at is null;

-- Who reported an issue, so a volunteer can follow the ones they reported.
alter table issues add column if not exists reported_by integer references users(id) on delete set null;

-- ---- Task notes and planned shifts (Step 5C, part 4) ----
-- A note thread on a task: the volunteer and the administrators can both write in it.
create table if not exists task_notes (
  id          serial primary key,
  task_id     integer not null references tasks(id) on delete cascade,
  user_id     integer not null references users(id) on delete cascade,
  body        text not null check (length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists task_notes_task_idx on task_notes (task_id, id);

-- Planned shifts: when an administrator expects a volunteer to be on duty (separate from the
-- check-in / check-out records, which show when they really were).
create table if not exists shift_slots (
  id         serial primary key,
  user_id    integer not null references users(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null check (ends_at > starts_at),
  place      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists shift_slots_user_idx on shift_slots (user_id, starts_at);

create table if not exists participant_events (id integer primary key, title text not null, category text not null, date timestamptz not null, location text not null, image text not null, description text not null, capacity integer not null check(capacity>0));
create table if not exists participant_registrations (user_id integer references users(id) on delete cascade, event_id integer references participant_events(id) on delete cascade, primary key(user_id,event_id));
create table if not exists participant_teams (id serial primary key, name text not null, event_id integer not null references participant_events(id));
create unique index if not exists participant_team_name on participant_teams(lower(name));
create table if not exists participant_members (team_id integer references participant_teams(id) on delete cascade, user_id integer references users(id) on delete cascade, primary key(team_id,user_id));
create table if not exists participant_announcements (id serial primary key, title text not null, body text not null, created_at timestamptz not null default now());

-- EventOps shared catalog v1
alter table events add column if not exists category text not null default 'General';
alter table events add column if not exists venue text not null default '';
alter table events add column if not exists description text not null default '';
alter table events add column if not exists image_url text not null default '';
alter table events add column if not exists capacity integer not null default 100 check (capacity > 0);
alter table events add column if not exists published boolean not null default false;
alter table events add column if not exists registration_open boolean not null default false;
alter table events add column if not exists team_enabled boolean not null default false;

-- shared participant v2
create table if not exists event_registrations(user_id integer not null references users(id) on delete cascade,event_id integer not null references events(id) on delete cascade,ticket_ref text not null unique default gen_random_uuid()::text,primary key(user_id,event_id));
create table if not exists event_teams(id serial primary key,event_id integer not null references events(id) on delete cascade,name text not null,unique(id,event_id));
create unique index if not exists event_teams_name on event_teams(event_id,lower(name));
create table if not exists event_team_members(team_id integer not null,event_id integer not null,user_id integer not null references users(id) on delete cascade,foreign key(team_id,event_id) references event_teams(id,event_id) on delete cascade,primary key(event_id,user_id));
create index if not exists event_registrations_event on event_registrations(event_id);
create index if not exists event_team_members_team on event_team_members(team_id);
