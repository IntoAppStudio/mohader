-- Additive: teacher/university space. A teacher shares a built course once; every enrolled
-- student gets READ access to the verified pack via RLS (no copying, no extra AI cost).
create table if not exists public.course_shares (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  share_code text not null unique,
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  share_id uuid not null references public.course_shares on delete cascade,
  student_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);
alter table public.course_shares enable row level security;
alter table public.course_enrollments enable row level security;
grant select, insert, update, delete on public.course_shares to authenticated;
grant select, delete on public.course_enrollments to authenticated;
grant all on public.course_shares, public.course_enrollments to service_role;
drop policy if exists "owner manages shares" on public.course_shares;
create policy "owner manages shares" on public.course_shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()));
drop policy if exists "student reads own enrollment" on public.course_enrollments;
create policy "student reads own enrollment" on public.course_enrollments for select to authenticated
  using (student_id = auth.uid() or exists (select 1 from public.course_shares s where s.id = share_id and s.owner_id = auth.uid()));
drop policy if exists "student leaves" on public.course_enrollments;
create policy "student leaves" on public.course_enrollments for delete to authenticated using (student_id = auth.uid());

-- Joining happens only through this function (validates the code; clients cannot insert enrollments).
create or replace function public.join_course_share(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.course_shares%rowtype;
begin
  select * into s from public.course_shares where share_code = p_code and is_active;
  if not found then raise exception 'SHARE_NOT_FOUND'; end if;
  insert into public.course_enrollments (course_id, share_id, student_id)
  values (s.course_id, s.id, auth.uid()) on conflict (course_id, student_id) do nothing;
  return s.course_id;
end $$;
revoke all on function public.join_course_share(text) from public, anon;
grant execute on function public.join_course_share(text) to authenticated;

-- Read access for enrolled students to the published pack only.
create or replace function public.is_enrolled(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.course_enrollments e
    join public.course_shares s on s.id = e.share_id
    where e.course_id = p_course and e.student_id = auth.uid() and s.is_active)
$$;
grant execute on function public.is_enrolled(uuid) to authenticated;

drop policy if exists "enrolled read courses" on public.courses;
create policy "enrolled read courses" on public.courses for select to authenticated using (public.is_enrolled(id));
drop policy if exists "enrolled read units" on public.units;
create policy "enrolled read units" on public.units for select to authenticated using (public.is_enrolled(course_id));
drop policy if exists "enrolled read chapters" on public.chapters;
create policy "enrolled read chapters" on public.chapters for select to authenticated using (public.is_enrolled(course_id));
drop policy if exists "enrolled read lessons" on public.lessons;
create policy "enrolled read lessons" on public.lessons for select to authenticated using (public.is_enrolled(course_id));
drop policy if exists "enrolled read summaries" on public.summaries;
create policy "enrolled read summaries" on public.summaries for select to authenticated using (public.is_enrolled(course_id) and is_published);
drop policy if exists "enrolled read questions" on public.questions;
create policy "enrolled read questions" on public.questions for select to authenticated using (public.is_enrolled(course_id) and is_published);
drop policy if exists "enrolled read references" on public.source_references;
create policy "enrolled read references" on public.source_references for select to authenticated using (public.is_enrolled(course_id));
