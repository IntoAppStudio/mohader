CREATE TABLE public.source_media (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  file_version integer NOT NULL DEFAULT 1,
  content_block_id uuid REFERENCES public.content_blocks(id) ON DELETE SET NULL,
  storage_path text,
  mime_type text NOT NULL DEFAULT 'image/png',
  page integer,
  position integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'figure',
  caption text,
  vision_text text,
  vision_status text NOT NULL DEFAULT 'PENDING',
  confidence numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_media TO authenticated;
GRANT ALL ON public.source_media TO service_role;

ALTER TABLE public.source_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own source media"
ON public.source_media FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX source_media_course_idx ON public.source_media (course_id, file_id, position);

CREATE TRIGGER t_source_media_upd
BEFORE UPDATE ON public.source_media
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS accuracy jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS extraction_report jsonb NOT NULL DEFAULT '{}'::jsonb;