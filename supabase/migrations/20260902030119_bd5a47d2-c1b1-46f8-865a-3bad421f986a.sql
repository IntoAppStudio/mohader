alter table public.profiles
  add column if not exists content_language text not null default 'ar',
  add column if not exists video_language text not null default 'ar';

alter table public.lessons
  add column if not exists formulas jsonb not null default '[]'::jsonb,
  add column if not exists figures jsonb not null default '[]'::jsonb,
  add column if not exists worked_examples jsonb not null default '[]'::jsonb,
  add column if not exists source_pages jsonb not null default '[]'::jsonb,
  add column if not exists content_language text;

alter table public.videos
  add column if not exists language text not null default 'ar',
  add column if not exists title text,
  add column if not exists duration_ms integer not null default 0;

alter table public.video_scenes
  add column if not exists title text,
  add column if not exists narration text,
  add column if not exists visual text,
  add column if not exists kind text not null default 'explanation';