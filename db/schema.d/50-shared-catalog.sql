-- EventOps shared catalog v1
alter table events add column if not exists category text not null default 'General';
alter table events add column if not exists venue text not null default '';
alter table events add column if not exists description text not null default '';
alter table events add column if not exists image_url text not null default '';
alter table events add column if not exists capacity integer not null default 100 check (capacity > 0);
alter table events add column if not exists published boolean not null default false;
alter table events add column if not exists registration_open boolean not null default false;
alter table events add column if not exists team_enabled boolean not null default false;
