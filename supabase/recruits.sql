-- Reply inbox, subject-line testing, recruit welcome portal. Safe to re-run.

-- replies sent from the CRM go back into the same Gmail thread
alter table public.outbox add column if not exists reply_thread text default '';
-- which subject line a batch email used (A/B test)
alter table public.outbox add column if not exists variant text default '';

-- private links for new recruits (one per recruit)
create table if not exists public.portals (
  token uuid primary key default gen_random_uuid(),
  agent_id uuid not null unique references public.agents(id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.portals enable row level security;
drop policy if exists pt_all on public.portals;
create policy pt_all on public.portals for all
  using ((select public.my_role()) in ('owner','manager'))
  with check ((select public.my_role()) in ('owner','manager'));

-- documents recruits upload through their link
create table if not exists public.recruit_docs (
  id bigserial primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  item text not null,
  path text not null,
  name text default '',
  at timestamptz default now()
);
create index if not exists recruit_docs_agent on public.recruit_docs(agent_id);
alter table public.recruit_docs enable row level security;
drop policy if exists rd_sel on public.recruit_docs;
create policy rd_sel on public.recruit_docs for select using ((select public.my_role()) in ('owner','manager'));
drop policy if exists rd_del on public.recruit_docs;
create policy rd_del on public.recruit_docs for delete using ((select public.is_owner()));

-- private file storage for those documents
insert into storage.buckets (id, name, public, file_size_limit)
values ('recruit-docs', 'recruit-docs', false, 15728640)
on conflict (id) do nothing;
drop policy if exists "recruit docs read" on storage.objects;
create policy "recruit docs read" on storage.objects for select
  using (bucket_id = 'recruit-docs' and (select public.my_role()) in ('owner','manager'));

do $$ begin
  begin alter publication supabase_realtime add table public.recruit_docs; exception when others then null; end;
end $$;

select 'ok' as result;
