-- ClearPoint CRM: calendar calls, send-from-business-email outbox, campaign stats, goals, saved lists.
-- Safe to re-run.

-- Calls on Frank's Google Calendar (synced by the email campaign script every hour)
create table if not exists public.calls (
  id text primary key,
  start_at timestamptz not null,
  end_at timestamptz,
  title text default '',
  meet_url text default '',
  guest_email text default '',
  guest_name text default '',
  agent_id uuid references public.agents(id) on delete set null,
  updated_at timestamptz default now()
);
create index if not exists calls_start on public.calls(start_at);
alter table public.calls enable row level security;
drop policy if exists c_sel on public.calls;
create policy c_sel on public.calls for select using ((select public.my_role()) in ('owner','manager'));

-- Emails written in the CRM and sent from fadybashir@clearpointglobal.org by the campaign script
create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  to_email text not null,
  subject text default '',
  body text default '',
  status text not null default 'queued' check (status in ('queued','sending','sent','error')),
  thread_id text default '',
  error text default '',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists outbox_status on public.outbox(status, created_at);
alter table public.outbox enable row level security;
drop policy if exists ob_sel on public.outbox;
create policy ob_sel on public.outbox for select using ((select public.is_owner()));
drop policy if exists ob_ins on public.outbox;
create policy ob_ins on public.outbox for insert with check ((select public.is_owner()) and created_by = (select auth.uid()));
drop policy if exists ob_del on public.outbox;
create policy ob_del on public.outbox for delete using ((select public.is_owner()) and status = 'queued');

-- Campaign numbers (from the script) and weekly team goals (set by Frank)
alter table public.org_settings add column if not exists campaign jsonb;
alter table public.org_settings add column if not exists goals jsonb default '{}'::jsonb;

-- Each person's saved lead lists
alter table public.profiles add column if not exists views jsonb default '[]'::jsonb;

do $$ begin
  begin alter publication supabase_realtime add table public.calls; exception when others then null; end;
  begin alter publication supabase_realtime add table public.outbox; exception when others then null; end;
  begin alter publication supabase_realtime add table public.org_settings; exception when others then null; end;
end $$;

select 'ok' as result;
