-- AI-generated lesson narration audio. Deliberately a separate bucket from
-- both 'sources' (user-uploaded course material) and 'note-media' (personal
-- text/image/voice notes) — different content, different owner (the app
-- generates this, not the user directly), same private/owner-scoped pattern.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-audio', 'lesson-audio', false, 26214400, array['audio/mpeg', 'audio/mp4', 'audio/wav'])
on conflict (id) do nothing;

drop policy if exists "read own lesson audio" on storage.objects;
create policy "read own lesson audio" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- Insert/delete are service-role only (client.server.ts) — audio is written
-- by the TTS pipeline, never uploaded directly by the browser, so there is
-- deliberately no "authenticated" insert/delete policy here (service_role
-- bypasses RLS entirely already).
