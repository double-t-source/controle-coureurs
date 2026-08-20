-- `locations` had RLS enabled with only a SELECT policy (it was previously a read-only
-- seed table with no admin UI to write to it). The new checkpoint-management screen in
-- SuperAdmin needs to insert/update/delete rows, which RLS was silently blocking.
create policy "Enable insert for all users" on locations for insert with check (true);
create policy "Enable update for all users" on locations for update using (true);
create policy "Enable delete for all users" on locations for delete using (true);
