-- Additive migration only: nothing existing is altered or dropped.
-- Covers: DB-backed job queue claim, AI usage ledger, credit wallet and
-- reservations, content-hash cache, retention, compliance, one-time packs,
-- regional pricing, and seeds for new plan/pack data.

-- ============ AI usage ledger (cost per call per user) ============
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  job_id uuid references public.jobs on delete set null,
  course_id uuid references public.courses on delete set null,
  kind text not null,
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  credits numeric(12,4) not null default 0,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);
alter table public.ai_usage_events enable row level security;
grant select on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;
drop policy if exists "read own ai usage" on public.ai_usage_events;
create policy "read own ai usage" on public.ai_usage_events for select to authenticated
  using (user_id = auth.uid());

-- ============ Credit wallet + reservations ============
create table if not exists public.credit_wallets (
  user_id uuid primary key references auth.users on delete cascade,
  period_start timestamptz not null default date_trunc('month', now()),
  total_credits integer not null default 0,
  used_credits integer not null default 0,
  reserved_credits integer not null default 0,
  -- One-time exam-pack credits: granted once on payment, NOT reset monthly, expire at bonus_expires_at.
  bonus_credits integer not null default 0,
  bonus_expires_at timestamptz,
  warned_80 boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.credit_wallets enable row level security;
grant select on public.credit_wallets to authenticated;
grant all on public.credit_wallets to service_role;
drop policy if exists "read own wallet" on public.credit_wallets;
create policy "read own wallet" on public.credit_wallets for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  job_id uuid references public.jobs on delete set null,
  credits integer not null,
  settled_credits integer,
  status text not null default 'RESERVED' check (status in ('RESERVED','SETTLED','RELEASED')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists credit_reservations_user_idx on public.credit_reservations (user_id, status);
alter table public.credit_reservations enable row level security;
grant select on public.credit_reservations to authenticated;
grant all on public.credit_reservations to service_role;
drop policy if exists "read own reservations" on public.credit_reservations;
create policy "read own reservations" on public.credit_reservations for select to authenticated
  using (user_id = auth.uid());

-- Atomic reserve: fails (returns false) when the wallet cannot cover it.
create or replace function public.reserve_credits(p_user uuid, p_job uuid, p_credits integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean;
begin
  update public.credit_wallets
     set reserved_credits = reserved_credits + p_credits, updated_at = now()
   where user_id = p_user
     and used_credits + reserved_credits + p_credits <=
         total_credits + case when bonus_expires_at is null or bonus_expires_at > now() then bonus_credits else 0 end
  returning true into v_ok;
  if v_ok is null then return null; end if;
  insert into public.credit_reservations (user_id, job_id, credits)
  values (p_user, p_job, p_credits) returning id into v_id;
  return v_id;
end $$;

-- Grants a paid exam pack once (idempotent per purchase id via one_time_purchases.status).
create or replace function public.grant_pack_credits(p_user uuid, p_credits integer, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.credit_wallets (user_id, total_credits, bonus_credits, bonus_expires_at)
  values (p_user, 0, p_credits, p_expires)
  on conflict (user_id) do update
    set bonus_credits = case when public.credit_wallets.bonus_expires_at is not null and public.credit_wallets.bonus_expires_at <= now()
                             then p_credits else public.credit_wallets.bonus_credits + p_credits end,
        bonus_expires_at = greatest(coalesce(public.credit_wallets.bonus_expires_at, p_expires), p_expires),
        warned_80 = false, updated_at = now();
end $$;
revoke all on function public.grant_pack_credits(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.grant_pack_credits(uuid, integer, timestamptz) to service_role;

-- Settle: release the reservation and charge the actual amount.
create or replace function public.settle_credits(p_reservation uuid, p_actual integer)
returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_reservations%rowtype;
begin
  select * into r from public.credit_reservations where id = p_reservation and status = 'RESERVED' for update;
  if not found then return; end if;
  update public.credit_wallets
     set reserved_credits = greatest(0, reserved_credits - r.credits),
         used_credits = used_credits + greatest(0, p_actual),
         updated_at = now()
   where user_id = r.user_id;
  update public.credit_reservations
     set status = 'SETTLED', settled_credits = greatest(0, p_actual), settled_at = now()
   where id = p_reservation;
end $$;

create or replace function public.release_credits(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_reservations%rowtype;
begin
  select * into r from public.credit_reservations where id = p_reservation and status = 'RESERVED' for update;
  if not found then return; end if;
  update public.credit_wallets
     set reserved_credits = greatest(0, reserved_credits - r.credits), updated_at = now()
   where user_id = r.user_id;
  update public.credit_reservations set status = 'RELEASED', settled_at = now() where id = p_reservation;
end $$;
revoke all on function public.reserve_credits(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_credits(uuid) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, uuid, integer) to service_role;
grant execute on function public.settle_credits(uuid, integer) to service_role;
grant execute on function public.release_credits(uuid) to service_role;

-- ============ Real queue: atomic claim with SKIP LOCKED ============
create or replace function public.claim_next_job(p_kinds text[], p_max_attempts integer default 3)
returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with next_job as (
    select id from public.jobs
     where status = 'QUEUED' and kind = any(p_kinds) and attempts < p_max_attempts
       and (payload->>'next_attempt_at' is null or (payload->>'next_attempt_at')::timestamptz <= now())
     order by created_at asc
     for update skip locked
     limit 1
  )
  update public.jobs j
     set status = 'RUNNING', attempts = j.attempts + 1, updated_at = now()
    from next_job
   where j.id = next_job.id
  returning j.*;
end $$;
revoke all on function public.claim_next_job(text[], integer) from public, anon, authenticated;
grant execute on function public.claim_next_job(text[], integer) to service_role;

-- ============ Content-hash cache (avoid re-processing identical input) ============
create table if not exists public.ai_cache (
  cache_key text primary key,
  user_id uuid references auth.users on delete cascade,
  kind text not null,
  response jsonb not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);
create index if not exists ai_cache_created_idx on public.ai_cache (created_at);
alter table public.ai_cache enable row level security;
grant all on public.ai_cache to service_role;
-- no policy for authenticated: server-only.

-- ============ Retention: scheduled deletion of uploaded files ============
create table if not exists public.file_retention (
  file_id uuid primary key references public.files on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  delete_after timestamptz not null,
  deleted_at timestamptz
);
create index if not exists file_retention_due_idx on public.file_retention (delete_after) where deleted_at is null;
alter table public.file_retention enable row level security;
grant select on public.file_retention to authenticated;
grant all on public.file_retention to service_role;
drop policy if exists "read own retention" on public.file_retention;
create policy "read own retention" on public.file_retention for select to authenticated
  using (user_id = auth.uid());

-- ============ Compliance: terms acceptance, minors, guardian consent ============
create table if not exists public.user_compliance (
  user_id uuid primary key references auth.users on delete cascade,
  terms_version text,
  terms_accepted_at timestamptz,
  birth_year integer,
  is_minor boolean not null default false,
  guardian_email text,
  guardian_consent_at timestamptz,
  copyright_declared_at timestamptz,
  retention_days integer not null default 365,
  updated_at timestamptz not null default now()
);
alter table public.user_compliance enable row level security;
grant select, insert, update on public.user_compliance to authenticated;
grant all on public.user_compliance to service_role;
drop policy if exists "own compliance select" on public.user_compliance;
create policy "own compliance select" on public.user_compliance for select to authenticated using (user_id = auth.uid());
drop policy if exists "own compliance insert" on public.user_compliance;
create policy "own compliance insert" on public.user_compliance for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own compliance update" on public.user_compliance;
create policy "own compliance update" on public.user_compliance for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ Payments: one-time packs + regional pricing ============
create table if not exists public.credit_packs (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  credits integer not null,
  valid_days integer not null default 60,
  price_usd numeric(8,2) not null,
  is_active boolean not null default true,
  position integer not null default 0
);
alter table public.credit_packs enable row level security;
grant select on public.credit_packs to anon, authenticated;
grant all on public.credit_packs to service_role;
drop policy if exists "packs readable" on public.credit_packs;
create policy "packs readable" on public.credit_packs for select to anon, authenticated using (is_active);

create table if not exists public.regional_prices (
  country text not null,
  item_id text not null,
  currency text not null,
  amount numeric(10,2) not null,
  providers text[] not null default '{}',
  primary key (country, item_id)
);
alter table public.regional_prices enable row level security;
grant select on public.regional_prices to anon, authenticated;
grant all on public.regional_prices to service_role;
drop policy if exists "regional prices readable" on public.regional_prices;
create policy "regional prices readable" on public.regional_prices for select to anon, authenticated using (true);

create table if not exists public.one_time_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  pack_id text not null references public.credit_packs,
  provider text not null,
  provider_ref text,
  amount numeric(10,2),
  currency text,
  status text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','REFUNDED')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
alter table public.one_time_purchases enable row level security;
grant select on public.one_time_purchases to authenticated;
grant all on public.one_time_purchases to service_role;
drop policy if exists "read own purchases" on public.one_time_purchases;
create policy "read own purchases" on public.one_time_purchases for select to authenticated using (user_id = auth.uid());

-- ============ Later features (storage only; logic in src/lib/*.server.ts) ============
create table if not exists public.exam_style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  source_file_ids uuid[] not null default '{}',
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (course_id)
);
alter table public.exam_style_profiles enable row level security;
grant select, insert, update, delete on public.exam_style_profiles to authenticated;
grant all on public.exam_style_profiles to service_role;
drop policy if exists "own exam style" on public.exam_style_profiles;
create policy "own exam style" on public.exam_style_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.mistake_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete set null,
  question_id uuid references public.questions on delete set null,
  reason text not null check (reason in ('CONCEPT','CALCULATION','CARELESS','TERMINOLOGY','MEMORY','UNKNOWN')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists mistake_analyses_user_idx on public.mistake_analyses (user_id, course_id);
alter table public.mistake_analyses enable row level security;
grant select, insert, update, delete on public.mistake_analyses to authenticated;
grant all on public.mistake_analyses to service_role;
drop policy if exists "own mistakes" on public.mistake_analyses;
create policy "own mistakes" on public.mistake_analyses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.lesson_timelines (
  lesson_id uuid primary key references public.lessons on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  audio_lesson_id uuid references public.audio_lessons on delete set null,
  timeline jsonb not null default '[]'::jsonb,
  duration_seconds numeric(10,2),
  created_at timestamptz not null default now()
);
alter table public.lesson_timelines enable row level security;
grant select on public.lesson_timelines to authenticated;
grant all on public.lesson_timelines to service_role;
drop policy if exists "read own timelines" on public.lesson_timelines;
create policy "read own timelines" on public.lesson_timelines for select to authenticated using (user_id = auth.uid());

-- ============ Seeds (idempotent) ============
insert into public.credit_packs (id, name_ar, name_en, credits, valid_days, price_usd, position) values
  ('exam_pack_s', 'باقة امتحان صغيرة', 'Small exam pack', 150, 45, 4.00, 0),
  ('exam_pack_m', 'باقة امتحان', 'Exam pack', 400, 60, 9.00, 1),
  ('exam_pack_l', 'باقة امتحان كبرى', 'Large exam pack', 1000, 90, 19.00, 2)
on conflict (id) do nothing;

insert into public.regional_prices (country, item_id, currency, amount, providers) values
  ('SA', 'exam_pack_m', 'SAR', 29.00, '{mada,stcpay,applepay,card}'),
  ('EG', 'exam_pack_m', 'EGP', 249.00, '{fawry,wallet,card}'),
  ('AE', 'exam_pack_m', 'AED', 29.00, '{card,applepay}'),
  ('JO', 'exam_pack_m', 'JOD', 6.00, '{card,wallet}'),
  ('KW', 'exam_pack_m', 'KWD', 2.50, '{knet,card}')
on conflict (country, item_id) do nothing;

insert into public.feature_flags (key, enabled, description) values
  ('queue_processing', false, 'Process builds through the DB-backed job queue'),
  ('credits_enforced', false, 'Enforce token-based credit reservation on builds'),
  ('server_tts', false, 'Use server-side TTS audio instead of browser speechSynthesis'),
  ('whiteboard', false, 'Show the whiteboard player on lessons'),
  ('review_mode', true, 'Send weakly supported items to review instead of silently dropping')
on conflict (key) do nothing;

-- Backfill: existing uploads also get a deletion date (365 days from now unless the user chose otherwise).
insert into public.file_retention (file_id, user_id, delete_after)
select f.id, f.user_id, now() + interval '365 days' from public.files f
on conflict (file_id) do nothing;
