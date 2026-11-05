create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create or replace function app.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function app.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','super_admin'))
$$;

revoke all on function app.has_role(uuid, public.app_role) from public;
revoke all on function app.is_admin(uuid) from public;
grant execute on function app.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function app.is_admin(uuid) to authenticated, service_role;

drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.is_admin(auth.uid()));

drop policy if exists "admins manage roles" on public.user_roles;
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (app.has_role(auth.uid(), 'super_admin')) with check (app.has_role(auth.uid(), 'super_admin'));

drop policy if exists "admins read events" on public.analytics_events;
create policy "admins read events" on public.analytics_events for select to authenticated
  using (app.is_admin(auth.uid()));

drop policy if exists "read own audit" on public.audit_logs;
create policy "read own audit" on public.audit_logs for select to authenticated
  using (user_id = auth.uid() or app.is_admin(auth.uid()));

drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or app.is_admin(auth.uid()));

drop policy if exists "admins manage subscriptions" on public.subscriptions;
create policy "admins manage subscriptions" on public.subscriptions for all to authenticated
  using (app.is_admin(auth.uid())) with check (app.is_admin(auth.uid()));

drop policy if exists "admins write plans" on public.plans;
create policy "admins write plans" on public.plans for all to authenticated
  using (app.is_admin(auth.uid())) with check (app.is_admin(auth.uid()));

drop policy if exists "admins write flags" on public.feature_flags;
create policy "admins write flags" on public.feature_flags for all to authenticated
  using (app.is_admin(auth.uid())) with check (app.is_admin(auth.uid()));

drop policy if exists "admins write settings" on public.app_settings;
create policy "admins write settings" on public.app_settings for all to authenticated
  using (app.is_admin(auth.uid())) with check (app.is_admin(auth.uid()));

drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles for select to authenticated
  using (app.is_admin(auth.uid()));

drop function if exists public.has_role(uuid, public.app_role);
drop function if exists public.is_admin(uuid);