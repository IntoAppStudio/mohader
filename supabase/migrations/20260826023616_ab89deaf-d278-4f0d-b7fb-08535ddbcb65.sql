-- ============ shared helpers ============
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create type public.app_role as enum ('user','admin','super_admin');
create type public.support_status as enum ('SUPPORTED','PARTIALLY_SUPPORTED','UNSUPPORTED','UNCLEAR','CONFLICTING');
create type public.file_status as enum ('UPLOADING','PROCESSING','READING','OCR','EXTRACTING_STRUCTURE','ORGANIZING','INDEXING','QUALITY_CHECK','READY','FAILED');
create type public.job_status as enum ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED');
create type public.question_type as enum ('MCQ','TRUE_FALSE','FILL_BLANK','DEFINITION','MATCHING','ORDERING','SHORT_ANSWER','CALCULATION','SCENARIO','PROBLEM_SOLVING');

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  language text not null default 'ar',
  theme text not null default 'system',
  study_prefs jsonb not null default '{}'::jsonb,
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger t_profiles_upd before update on public.profiles for each row execute function public.set_updated_at();

-- ============ roles ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','super_admin')) $$;

create policy "read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ============ signup bootstrap ============
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'مساحتي',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
create policy "own workspaces" on public.workspaces for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger t_ws_upd before update on public.workspaces for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  insert into public.workspaces (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
-- ============ courses & structure ============
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null,
  subject text,
  description text,
  language text not null default 'ar',
  exam_date date,
  is_built boolean not null default false,
  built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  unit_id uuid references public.units on delete cascade,
  title text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  chapter_id uuid references public.chapters on delete cascade,
  title text not null,
  objective text,
  explanation_simple text,
  explanation_standard text,
  explanation_detailed text,
  position int not null default 0,
  support_status public.support_status not null default 'UNCLEAR',
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  title text not null,
  mastery numeric not null default 0,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ files / sources ============
create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  current_version int not null default 1,
  status public.file_status not null default 'UPLOADING',
  status_detail text,
  error_message text,
  quality jsonb not null default '{}'::jsonb,
  security_status text not null default 'PENDING',
  page_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  file_id uuid not null references public.files on delete cascade,
  version int not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  checksum text,
  created_at timestamptz not null default now(),
  unique (file_id, version)
);

create table public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  file_id uuid not null references public.files on delete cascade,
  file_version int not null default 1,
  page int,
  section text,
  block_type text not null default 'paragraph',
  original_text text not null,
  processed_text text,
  simplified_text text,
  coordinates jsonb,
  duplicate_group text,
  confidence numeric,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.source_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  topic text not null,
  block_a uuid references public.content_blocks on delete cascade,
  block_b uuid references public.content_blocks on delete cascade,
  difference text,
  resolved_block uuid references public.content_blocks on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ knowledge objects ============
create table public.definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  term text not null,
  definition text not null,
  support_status public.support_status not null default 'SUPPORTED',
  created_at timestamptz not null default now()
);

create table public.methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  title text not null,
  steps jsonb not null default '[]'::jsonb,
  original_text text not null,
  simplified_explanation text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  kind text not null default 'mukhtasar_mufeed',
  body text not null,
  validation jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  object_type text not null,
  object_id uuid not null,
  file_id uuid not null references public.files on delete cascade,
  file_version int not null default 1,
  page int,
  section text,
  quoted_text text,
  coordinates jsonb,
  content_block_id uuid references public.content_blocks on delete set null,
  created_at timestamptz not null default now()
);
-- ============ questions / exams ============
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  topic_id uuid references public.topics on delete set null,
  type public.question_type not null,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  explanation text,
  difficulty int not null default 2,
  support_status public.support_status not null default 'SUPPORTED',
  validation jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  attempts int not null default 0,
  correct_count int not null default 0,
  last_attempt_at timestamptz,
  next_review_at timestamptz,
  ease numeric not null default 2.5,
  interval_days int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  question_id uuid not null references public.questions on delete cascade,
  exam_id uuid,
  answer jsonb,
  is_correct boolean not null default false,
  time_spent_seconds int not null default 0,
  created_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'IN_PROGRESS',
  score numeric,
  correct_count int not null default 0,
  wrong_count int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  exam_id uuid not null references public.exams on delete cascade,
  question_id uuid not null references public.questions on delete cascade,
  position int not null default 0,
  answer jsonb,
  is_correct boolean,
  unique (exam_id, question_id)
);

-- ============ study plan / reviews / progress ============
create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  hours_per_day numeric not null default 1,
  preferred_days int[] not null default '{0,1,2,3,4,5,6}',
  exam_date date,
  target_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_id uuid not null references public.study_plans on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  scheduled_date date not null,
  minutes int not null default 30,
  kind text not null default 'LESSON',
  is_done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  seconds int not null default 0
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete cascade,
  topic_id uuid references public.topics on delete cascade,
  due_at timestamptz not null default now(),
  interval_days int not null default 1,
  ease numeric not null default 2.5,
  last_result text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references public.courses on delete cascade,
  lesson_id uuid references public.lessons on delete set null,
  title text,
  body text not null default '',
  approved_as_source boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lessons_total int not null default 0,
  lessons_completed int not null default 0,
  questions_answered int not null default 0,
  questions_correct int not null default 0,
  study_seconds int not null default 0,
  updated_at timestamptz not null default now(),
  unique (course_id)
);

-- ============ media (feature-flagged) ============
create table public.audio_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid not null references public.lessons on delete cascade,
  storage_path text,
  transcript text,
  duration_seconds int,
  status public.job_status not null default 'QUEUED',
  created_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  lesson_id uuid not null references public.lessons on delete cascade,
  mode text not null default 'DOCUMENT',
  storage_path text,
  status public.job_status not null default 'QUEUED',
  created_at timestamptz not null default now()
);

create table public.video_scenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  video_id uuid not null references public.videos on delete cascade,
  position int not null default 0,
  start_ms int not null default 0,
  end_ms int not null default 0,
  text_segment text,
  file_id uuid references public.files on delete set null,
  page int,
  coordinates jsonb
);

-- ============ jobs / audit / notifications / analytics ============
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references public.courses on delete cascade,
  file_id uuid references public.files on delete cascade,
  kind text not null,
  status public.job_status not null default 'QUEUED',
  progress int not null default 0,
  attempts int not null default 0,
  failure_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============ plans / subscriptions / config ============
create table public.plans (
  id text primary key,
  name_ar text not null,
  name_en text not null,
  price_monthly numeric not null default 0,
  price_yearly numeric not null default 0,
  currency text not null default 'USD',
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  position int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_id text not null references public.plans,
  status text not null default 'ACTIVE',
  period text not null default 'MONTHLY',
  provider text not null default 'NONE',
  provider_ref text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null default 'SUPPORT',
  subject text not null,
  body text not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default now()
);
-- ============ grants + RLS for all owner-scoped tables ============
do $$
declare t text;
  owned text[] := array[
    'courses','units','chapters','lessons','topics','files','file_versions','content_blocks',
    'source_conflicts','definitions','methods','summaries','source_references','questions',
    'question_attempts','exams','exam_questions','study_plans','study_plan_items','study_sessions',
    'reviews','notes','progress','audio_lessons','videos','video_scenes','jobs','notifications',
    'support_tickets'
  ];
begin
  foreach t in array owned loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "owner_all_%s" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());', t, t);
    execute format('create index if not exists idx_%s_user on public.%I (user_id);', t, t);
  end loop;
end $$;

-- updated_at triggers where the column exists
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema='public' and c.column_name='updated_at'
      and c.table_name not in ('profiles','workspaces')
  loop
    execute format('create trigger t_%s_upd before update on public.%I for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- analytics + audit: insert-own, admin-read
grant insert on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;
alter table public.analytics_events enable row level security;
create policy "insert own events" on public.analytics_events for insert to authenticated with check (user_id = auth.uid());
create policy "admins read events" on public.analytics_events for select to authenticated using (public.is_admin(auth.uid()));

grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "insert own audit" on public.audit_logs for insert to authenticated with check (user_id = auth.uid());
create policy "read own audit" on public.audit_logs for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- subscriptions: user reads own; only server/admin writes
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
alter table public.subscriptions enable row level security;
create policy "read own subscription" on public.subscriptions for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy "admins manage subscriptions" on public.subscriptions for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- public config tables: readable by everyone, writable by admins
grant select on public.plans to anon, authenticated;
grant all on public.plans to service_role;
alter table public.plans enable row level security;
create policy "plans readable" on public.plans for select to anon, authenticated using (true);
create policy "admins write plans" on public.plans for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.feature_flags to anon, authenticated;
grant all on public.feature_flags to service_role;
alter table public.feature_flags enable row level security;
create policy "flags readable" on public.feature_flags for select to anon, authenticated using (true);
create policy "admins write flags" on public.feature_flags for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "settings readable" on public.app_settings for select to anon, authenticated using (true);
create policy "admins write settings" on public.app_settings for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- admin visibility over user data for support (read-only)
create policy "admins read profiles" on public.profiles for select to authenticated using (public.is_admin(auth.uid()));
create policy "admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(),'super_admin')) with check (public.has_role(auth.uid(),'super_admin'));

-- ============ seed configuration ============
insert into public.plans (id, name_ar, name_en, price_monthly, price_yearly, limits, position) values
 ('free','مجاني','Free',0,0,'{"courses":1,"files_per_course":5,"storage_mb":100,"questions_per_month":100,"video":false,"audio":false}'::jsonb,0),
 ('student','طالب','Student',7,70,'{"courses":6,"files_per_course":40,"storage_mb":2000,"questions_per_month":3000,"video":false,"audio":true}'::jsonb,1),
 ('pro','احترافي','Pro',15,150,'{"courses":-1,"files_per_course":-1,"storage_mb":20000,"questions_per_month":-1,"video":true,"audio":true}'::jsonb,2);

insert into public.feature_flags (key, enabled, description) values
 ('audio_lessons', false, 'Audio lesson generation'),
 ('video_lessons', false, 'Video lesson generation and synchronized highlighting'),
 ('advanced_ocr', false, 'Advanced OCR provider'),
 ('billing', false, 'Payment provider connected');

insert into public.app_settings (key, value) values
 ('limits', '{"max_file_mb":25,"trial_days":7}'::jsonb),
 ('announcement', '{"active":false,"text_ar":"","text_en":""}'::jsonb);

-- ============ storage policies for the private sources bucket ============
create policy "read own source files" on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "upload own source files" on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own source files" on storage.objects for update to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own source files" on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);