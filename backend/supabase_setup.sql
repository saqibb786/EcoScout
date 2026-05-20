-- ============================================================
-- EcoScout Supabase Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Paste everything below → click "Run"
-- ============================================================

-- 1) Ensure 'media' bucket is public
UPDATE storage.buckets SET public = true WHERE id = 'media';

-- 2) Drop any existing policies on storage.objects for media bucket
--    (safe to run even if they don't exist)
DO $$
BEGIN
  -- Drop existing policies to avoid conflicts
  DROP POLICY IF EXISTS "Allow public read access on media" ON storage.objects;
  DROP POLICY IF EXISTS "Allow uploads to media bucket" ON storage.objects;
  DROP POLICY IF EXISTS "Allow updates to media bucket" ON storage.objects;
  DROP POLICY IF EXISTS "Allow deletes from media bucket" ON storage.objects;
END $$;

-- 3) Create permissive RLS policies for the media bucket
CREATE POLICY "Allow public read access on media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "Allow uploads to media bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Allow updates to media bucket"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'media');

CREATE POLICY "Allow deletes from media bucket"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'media');

-- 4) Create analyses table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.analyses (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timestamp_real TEXT,
  media_url TEXT,
  media_type TEXT DEFAULT 'image',
  detection_image_url TEXT,
  violation_name TEXT,
  detection_summary JSONB,
  total_detections INTEGER DEFAULT 0,
  report_url TEXT
);

-- 5) Create detections table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.detections (
  id TEXT PRIMARY KEY,
  analysis_id TEXT REFERENCES public.analyses(id) ON DELETE CASCADE,
  frame_index INTEGER,
  class_name TEXT,
  confidence DOUBLE PRECISION,
  bbox JSONB,
  ocr_text TEXT,
  ocr_confidence DOUBLE PRECISION
);

-- 6) Enable RLS + permissive policies on DB tables
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow full access to analyses" ON public.analyses;
  DROP POLICY IF EXISTS "Allow full access to detections" ON public.detections;
END $$;

CREATE POLICY "Allow full access to analyses"
  ON public.analyses FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow full access to detections"
  ON public.detections FOR ALL
  USING (true)
  WITH CHECK (true);

-- Done! You should see "Success. No rows returned." after running.
