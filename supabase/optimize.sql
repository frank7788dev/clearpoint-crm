-- Speed, clients, reports and queue control. Safe to re-run.
create index if not exists agents_updated on public.agents(updated_at);
create index if not exists activities_at on public.activities(at);
create index if not exists outbox_agent_sent on public.outbox(agent_id, status);

-- the owner can release or re-time emails that are still waiting
drop policy if exists ob_upd on public.outbox;
create policy ob_upd on public.outbox for update
  using ((select public.is_owner()) and status = 'queued')
  with check ((select public.is_owner()) and status = 'queued');

-- Clients: the people the agency has written policies for
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  first text default '', last text default '', email text default '', phone text default '', state text default '',
  agent_id uuid references public.agents(id) on delete set null,
  review date,
  notes text default '',
  policies jsonb default '[]'::jsonb,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.clients enable row level security;
drop policy if exists cl_all on public.clients;
create policy cl_all on public.clients for all
  using ((select public.my_role()) in ('owner','manager'))
  with check ((select public.my_role()) in ('owner','manager'));

-- Emails sent and replies received per day (Eastern time), for the Reports page
create or replace function public.report_daily(days int default 30)
returns table(day date, sent bigint, replies bigint)
language sql stable security definer set search_path = public as $$
  select d::date as day,
    (select count(*) from public.activities a where a.dir='out' and a.ch='email' and (a.at at time zone 'America/Detroit')::date = d::date) as sent,
    (select count(*) from public.activities a where a.dir='in' and (a.at at time zone 'America/Detroit')::date = d::date) as replies
  from generate_series((now() at time zone 'America/Detroit')::date - (least(greatest(days,1),90) - 1), (now() at time zone 'America/Detroit')::date, interval '1 day') d
  where (select public.my_role()) in ('owner','manager')
  order by 1;
$$;
revoke all on function public.report_daily(int) from public, anon;
grant execute on function public.report_daily(int) to authenticated;

select 'ok' as result;
