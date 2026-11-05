-- The app has always referenced a `sources` storage bucket (course upload
-- files) via RLS-style storage policies, but no migration ever created the
-- bucket itself or those policies as code — they most likely exist today
-- only because someone created them by hand in the Supabase dashboard.
-- This migration makes that reproducible from a fresh project, and is safe
-- to run against a project where the bucket/policies already exist:
--  - the bucket insert is a no-op if the id is already taken
--  - each policy is dropped-if-exists then recreated, so re-running this
--    (or having equivalent hand-made policies already) never errors
--
-- Deliberately does not touch the `note-media` bucket or its policies.

insert into storage.buckets (id, name, public, file_size_limit)
values ('sources', 'sources', false, 104857600) -- 100 MB per object
on conflict (id) do nothing;

-- No allowed_mime_types restriction here on purpose: office formats
-- (.docx/.pptx/.xlsx) are matched by file extension in
-- src/lib/extract.server.ts precisely because browsers/OSes send
-- inconsistent MIME types for them (application/octet-stream is common).
-- A strict bucket-level MIME allowlist would risk rejecting valid uploads
-- that the application layer already knows how to handle.

drop policy if exists "read own source files" on storage.objects;
create policy "read own source files" on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "upload own source files" on storage.objects;
create policy "upload own source files" on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own source files" on storage.objects;
create policy "delete own source files" on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

-- Deliberately no UPDATE policy: the app always uploads-then-registers a new
-- object rather than overwriting one in place (see files.functions.ts /
-- notes.functions.ts), matching the existing pattern.
