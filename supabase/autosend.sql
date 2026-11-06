-- Auto-send: batches of first emails scheduled through the day, sent from the business mailbox.
alter table public.outbox add column if not exists scheduled_for timestamptz default now();
alter table public.outbox add column if not exists kind text default 'single';
create index if not exists outbox_due on public.outbox(status, scheduled_for);
alter table public.org_settings add column if not exists autosend jsonb default '{}'::jsonb;
select 'ok' as result;
