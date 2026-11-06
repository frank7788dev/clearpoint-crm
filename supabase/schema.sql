-- ClearPoint Recruiting CRM: shared database, logins and roles
-- Run once in Supabase → SQL Editor. Safe to re-run.

create extension if not exists pgcrypto;

-- ---------- people who use the app ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  full_name text default '',
  role text not null default 'pending' check (role in ('owner','manager','recruiter','pending','disabled')),
  manager_id uuid references public.profiles(id) on delete set null,
  sign_name text default '',
  phone text default '',
  calendar text default '',
  optin text default '',
  created_at timestamptz default now()
);
alter table public.profiles add column if not exists calendar text default '';
alter table public.profiles add column if not exists optin text default '';

-- owner/manager pre-approve teammates by email; the role applies when they create their login
create table if not exists public.invites (
  email text primary key,
  full_name text default '',
  role text not null check (role in ('manager','recruiter')),
  manager_id uuid references public.profiles(id) on delete set null,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ---------- helpers (security definer so policies don't recurse) ----------
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select role from profiles where id = auth.uid()), 'none') $$;

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() = 'owner' $$;

create or replace function public.is_active() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() in ('owner','manager','recruiter') $$;

-- me plus, for a manager, the recruiters who report to me
create or replace function public.my_team() returns setof uuid language sql stable security definer set search_path = public as
$$ select auth.uid() union select id from profiles where manager_id = auth.uid() and public.my_role() = 'manager' $$;

-- new login → profile. Frank's email is always the owner.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$
declare inv invites%rowtype;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  insert into profiles (id, email, full_name, role, manager_id)
  values (new.id, lower(new.email),
          coalesce(inv.full_name, ''),
          case when lower(new.email) = 'fadybashir3218@gmail.com' then 'owner' else coalesce(inv.role, 'pending') end,
          inv.manager_id)
  on conflict (id) do nothing;
  if inv.email is not null then delete from invites where email = inv.email; end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- only the owner can change roles or reporting lines; managers can attach recruiters to themselves
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if public.is_owner() then
    if old.role = 'owner' and new.role <> 'owner' and old.id = auth.uid() then raise exception 'The owner cannot demote themselves'; end if;
    return new;
  end if;
  if public.my_role() = 'manager' and old.id <> auth.uid() then
    if new.role not in ('recruiter','disabled') or (new.manager_id is distinct from auth.uid()) then raise exception 'Managers can only manage recruiters on their own team'; end if;
    return new;
  end if;
  if new.role is distinct from old.role or new.manager_id is distinct from old.manager_id or new.email is distinct from old.email then
    raise exception 'Only the owner can change roles';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

-- ---------- agents (prospects) ----------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  npn text default '',
  first text default '', last text default '',
  email text default '', phone text default '', mobile text default '',
  company text default '', title text default '', kind text default '',
  city text default '', state text default '', zip text default '',
  lic text default '', lines text default '', linkedin text default '', keywords text default '',
  notes text default '', source text default '', tier text default '',
  status text not null default 'new',
  sms jsonb, fu text default '', waiting boolean default false, last_touch jsonb, extra jsonb,
  added text default '',
  assigned_to uuid references public.profiles(id) on delete set null,
  updated_at timestamptz default now(),
  updated_by uuid default auth.uid()
);
create index if not exists agents_assigned on public.agents(assigned_to);
create index if not exists agents_state on public.agents(state);
create index if not exists agents_status on public.agents(status);
create unique index if not exists agents_npn_unique on public.agents(npn) where npn <> '';

create or replace function public.can_see_agent(a_assigned uuid) returns boolean language sql stable security definer set search_path = public as
$$ select public.is_owner()
       or (public.my_role() = 'manager' and (a_assigned is null or a_assigned in (select public.my_team())))
       or (public.my_role() = 'recruiter' and a_assigned = auth.uid()) $$;

create or replace function public.touch_agent() returns trigger language plpgsql as
$$ begin new.updated_at = now(); new.updated_by = auth.uid();
   if public.my_role() = 'recruiter' and new.assigned_to is distinct from old.assigned_to then raise exception 'Recruiters cannot reassign agents'; end if;
   return new; end $$;
drop trigger if exists touch_agent on public.agents;
create trigger touch_agent before update on public.agents for each row execute function public.touch_agent();

-- ---------- activity history ----------
create table if not exists public.activities (
  id bigserial primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  ch text default '', dir text default '', what text default '', sub text default '', body text default '',
  at timestamptz default now()
);
create index if not exists activities_agent on public.activities(agent_id, at desc);
create index if not exists activities_user on public.activities(user_id, at desc);

-- ---------- shared settings (scripts, agency) ----------
create table if not exists public.org_settings (
  id int primary key default 1 check (id = 1),
  agency text default 'ClearPoint Global',
  scripts jsonb,
  updated_at timestamptz default now()
);
insert into public.org_settings (id) values (1) on conflict do nothing;

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.agents enable row level security;
alter table public.activities enable row level security;
alter table public.org_settings enable row level security;

drop policy if exists p_sel on public.profiles;
create policy p_sel on public.profiles for select using (id = auth.uid() or public.is_active());
drop policy if exists p_upd on public.profiles;
create policy p_upd on public.profiles for update using (id = auth.uid() or public.is_owner() or (public.my_role() = 'manager' and (manager_id = auth.uid() or role = 'pending')));

drop policy if exists i_all on public.invites;
create policy i_all on public.invites for all
  using (public.is_owner() or (public.my_role() = 'manager' and invited_by = auth.uid()))
  with check (public.is_owner() or (public.my_role() = 'manager' and role = 'recruiter' and manager_id = auth.uid() and invited_by = auth.uid()));

drop policy if exists a_sel on public.agents;
create policy a_sel on public.agents for select using (public.can_see_agent(assigned_to));
drop policy if exists a_upd on public.agents;
create policy a_upd on public.agents for update using (public.can_see_agent(assigned_to)) with check (public.can_see_agent(assigned_to));
drop policy if exists a_ins on public.agents;
create policy a_ins on public.agents for insert with check (public.my_role() in ('owner','manager') or (public.my_role() = 'recruiter' and assigned_to = auth.uid()));
drop policy if exists a_del on public.agents;
create policy a_del on public.agents for delete using (public.is_owner());

drop policy if exists act_sel on public.activities;
create policy act_sel on public.activities for select using (exists (select 1 from public.agents a where a.id = agent_id));
drop policy if exists act_ins on public.activities;
create policy act_ins on public.activities for insert with check (user_id = auth.uid() and exists (select 1 from public.agents a where a.id = agent_id));
drop policy if exists act_del on public.activities;
create policy act_del on public.activities for delete using (user_id = auth.uid() or public.is_owner());

drop policy if exists o_sel on public.org_settings;
create policy o_sel on public.org_settings for select using (public.is_active());
drop policy if exists o_upd on public.org_settings;
create policy o_upd on public.org_settings for update using (public.is_owner());

-- ---------- team scoreboard (who sent what) ----------
create or replace function public.team_stats(since timestamptz default now() - interval '30 days')
returns table (user_id uuid, emails bigint, texts bigint, calls bigint, replies bigint, assigned bigint, joined bigint)
language sql stable security definer set search_path = public as
$$
  select p.id,
    (select count(*) from activities x where x.user_id = p.id and x.ch = 'email' and x.dir = 'out' and x.at >= since),
    (select count(*) from activities x where x.user_id = p.id and x.ch = 'text'  and x.dir = 'out' and x.at >= since),
    (select count(*) from activities x where x.user_id = p.id and x.ch = 'call'  and x.at >= since),
    (select count(*) from activities x where x.user_id = p.id and x.dir = 'in' and x.at >= since),
    (select count(*) from agents a where a.assigned_to = p.id),
    (select count(*) from agents a where a.assigned_to = p.id and a.status = 'joined')
  from profiles p
  where p.role in ('owner','manager','recruiter')
    and (public.is_owner() or p.id in (select public.my_team()))
$$;

-- ---------- live updates between teammates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.agents; exception when others then null; end;
  begin alter publication supabase_realtime add table public.activities; exception when others then null; end;
end $$;
