-- Territories: the owner gives whole states to a manager or recruiter. Safe to re-run.
alter table public.org_settings add column if not exists territories jsonb default '{}'::jsonb;

-- Give every agent in a state to one person (or nobody). Agents a manager has already
-- handed to their own recruiters stay with those recruiters.
create or replace function public.assign_state(p_state text, p_user uuid)
returns integer language plpgsql security definer set search_path = public as
$$
declare n integer;
begin
  if not public.is_owner() then raise exception 'Only the owner can hand out states'; end if;
  update org_settings
     set territories = case when p_user is null then coalesce(territories,'{}'::jsonb) - p_state
                            else coalesce(territories,'{}'::jsonb) || jsonb_build_object(p_state, p_user::text) end,
         updated_at = now()
   where id = 1;
  update agents a
     set assigned_to = p_user, updated_at = now(), updated_by = auth.uid()
   where a.state = p_state
     and a.assigned_to is distinct from p_user
     and (p_user is null or a.assigned_to is null
          or a.assigned_to not in (select id from profiles where manager_id = p_user));
  get diagnostics n = row_count;
  return n;
end $$;

-- New agents (imports, Apollo, added by hand) go straight to whoever owns their state.
create or replace function public.territory_on_insert() returns trigger language plpgsql security definer set search_path = public as
$$
declare who text;
begin
  if new.assigned_to is null and new.state <> '' then
    select territories ->> new.state into who from org_settings where id = 1;
    if who is not null then new.assigned_to = who::uuid; end if;
  end if;
  return new;
end $$;
drop trigger if exists territory_on_insert on public.agents;
create trigger territory_on_insert before insert on public.agents for each row execute function public.territory_on_insert();
