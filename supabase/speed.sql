-- Faster row-level security: evaluate the viewer's role once per query instead of once per row.
drop policy if exists a_sel on public.agents;
create policy a_sel on public.agents for select using (
  (select public.is_owner())
  or ((select public.my_role()) = 'manager' and (assigned_to is null or assigned_to in (select public.my_team())))
  or ((select public.my_role()) = 'recruiter' and assigned_to = (select auth.uid()))
);
drop policy if exists a_upd on public.agents;
create policy a_upd on public.agents for update using (
  (select public.is_owner())
  or ((select public.my_role()) = 'manager' and (assigned_to is null or assigned_to in (select public.my_team())))
  or ((select public.my_role()) = 'recruiter' and assigned_to = (select auth.uid()))
) with check (
  (select public.is_owner())
  or ((select public.my_role()) = 'manager' and (assigned_to is null or assigned_to in (select public.my_team())))
  or ((select public.my_role()) = 'recruiter' and assigned_to = (select auth.uid()))
);
analyze public.agents;
