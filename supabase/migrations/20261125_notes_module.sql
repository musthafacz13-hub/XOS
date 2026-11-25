-- ============================================================================
-- Migration: 20261125_notes_module.sql
-- Description: Independent Personal & Purchase Planning Notes Module
-- Target: Supabase PostgreSQL with Strict Row Level Security (RLS)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  content TEXT NOT NULL DEFAULT ''
    CHECK (char_length(btrim(content)) >= 1 AND char_length(content) <= 20000),
  note_type TEXT NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('general', 'purchase_plan', 'personal_plan', 'shopping_list', 'reminder', 'other')),
  estimated_amount NUMERIC(12, 2) NULL
    CHECK (estimated_amount IS NULL OR estimated_amount >= 0),
  target_date DATE NULL,
  additional_details TEXT NULL
    CHECK (additional_details IS NULL OR char_length(additional_details) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notes_user_updated
  ON public.notes(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_user_type
  ON public.notes(user_id, note_type);

-- ============================================================================
-- 3. INTEGRITY & TIMESTAMP TRIGGER (INVOKER, FIXED SEARCH_PATH)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_notes_updated_and_immutable_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Note ownership (user_id) cannot be reassigned.';
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_notes_updated_and_immutable_owner();

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes_select_own" ON public.notes;
CREATE POLICY "notes_select_own"
  ON public.notes
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_insert_own" ON public.notes;
CREATE POLICY "notes_insert_own"
  ON public.notes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_update_own" ON public.notes;
CREATE POLICY "notes_update_own"
  ON public.notes
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notes_delete_own" ON public.notes;
CREATE POLICY "notes_delete_own"
  ON public.notes
  FOR DELETE
  USING (auth.uid() = user_id);
