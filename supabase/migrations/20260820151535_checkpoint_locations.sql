-- Named, GPS-locatable checkpoints shared between races of an event, plus a
-- global setting for the auto-detection radius.

alter table locations add column latitude double precision;
alter table locations add column longitude double precision;

-- Dead column: always NULL in production, superseded by race_locations below.
alter table locations drop column events_id;

create table race_locations (
  race_id bigint not null references races(id) on delete cascade,
  location_id bigint not null references locations(id) on delete cascade,
  primary key (race_id, location_id)
);

create table app_settings (
  id smallint primary key default 1 check (id = 1),
  geo_radius_m integer not null default 250,
  updated_at timestamptz not null default now()
);
insert into app_settings (id) values (1);

-- Mirror the existing anon-key read/write policy already applied to
-- locations/event_gear (this app has no Supabase Auth — access control is
-- enforced client-side via hashed passwords, not RLS).
alter table race_locations enable row level security;
create policy "Enable read access for all users" on race_locations for select using (true);
create policy "Enable insert for all users" on race_locations for insert with check (true);
create policy "Enable update for all users" on race_locations for update using (true);
create policy "Enable delete for all users" on race_locations for delete using (true);

alter table app_settings enable row level security;
create policy "Enable read access for all users" on app_settings for select using (true);
create policy "Enable update for all users" on app_settings for update using (true);
