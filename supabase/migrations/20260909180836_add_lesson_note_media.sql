-- Personal per-lesson notes: text, an optional image, and/or an optional voice
-- recording, so a student can leave themselves a reminder on a lesson and
-- hear/see it again next time they study that lesson.
--
-- The `notes` table already exists (course_id/lesson_id, RLS via the generic
-- owner-scoped policy applied in the initial migration) — this only adds the
-- columns needed for image/audio attachments. Nothing about the existing
-- text-note behavior (including `approved_as_source`) changes.

alter table public.notes
  add column if not exists image_path text,
  add column if not exists audio_path text,
  add column if not exists audio_duration_seconds integer;

-- Dedicated bucket (separate from `sources`) so personal note attachments
-- never mix with course source files or their storage quota accounting
-- (src/lib/quota.server.ts sums `files.size_bytes`, not bucket contents, so
-- this bucket is intentionally outside that limit for now).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-media',
  'note-media',
  false,
  26214400, -- 25 MB per object
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav'
  ]
)
on conflict (id) do nothing;

-- Same ownership pattern as the `sources` bucket policies: the first path
-- segment must be the caller's own user id.
create policy "read own note media" on storage.objects for select to authenticated
  using (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "upload own note media" on storage.objects for insert to authenticated
  with check (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own note media" on storage.objects for delete to authenticated
  using (bucket_id = 'note-media' and (storage.foldername(name))[1] = auth.uid()::text);
