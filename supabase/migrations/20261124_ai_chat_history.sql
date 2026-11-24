-- ============================================================================
-- Migration: 20261124_ai_chat_history.sql
-- Description: Persistent AI Agent (Jarvis) Chat History & Conversation Management
-- Target: Supabase PostgreSQL with Strict Row Level Security (RLS)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat'
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  pinned BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  language_preference TEXT NOT NULL DEFAULT 'ml-IN'
    CHECK (language_preference IN ('auto', 'ml-IN', 'en-IN')),
  last_message_preview TEXT NOT NULL DEFAULT ''
    CHECK (char_length(last_message_preview) <= 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL
    CHECK (char_length(btrim(content)) > 0 AND char_length(content) <= 12000),
  message_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_message_id TEXT NOT NULL
    CHECK (char_length(btrim(client_message_id)) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ai_messages_conv_client_id UNIQUE (conversation_id, client_message_id)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_recent
  ON public.ai_conversations(user_id, archived, pinned DESC, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created
  ON public.ai_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_messages_user_conv
  ON public.ai_messages(user_id, conversation_id);

-- ============================================================================
-- 3. INTEGRITY & OWNERSHIP TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_ai_conversation_user_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Conversation ownership (user_id) cannot be reassigned.';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_conversations_immutable_owner ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_immutable_owner
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_conversation_user_change();

CREATE OR REPLACE FUNCTION public.validate_ai_message_ownership_and_immutability()
RETURNS TRIGGER AS $$
DECLARE
  v_conv_owner UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Message ownership (user_id) cannot be reassigned.';
    END IF;
    IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
      RAISE EXCEPTION 'Message conversation_id cannot be reassigned.';
    END IF;
    IF NEW.client_message_id IS DISTINCT FROM OLD.client_message_id THEN
      RAISE EXCEPTION 'Message client_message_id is immutable.';
    END IF;
  END IF;

  SELECT user_id INTO v_conv_owner
  FROM public.ai_conversations
  WHERE id = NEW.conversation_id;

  IF v_conv_owner IS NULL THEN
    RAISE EXCEPTION 'Target conversation does not exist.';
  END IF;

  IF v_conv_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Message user_id must match parent conversation owner.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_ai_messages_validate_ownership ON public.ai_messages;
CREATE TRIGGER trg_ai_messages_validate_ownership
  BEFORE INSERT OR UPDATE ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_message_ownership_and_immutability();

CREATE OR REPLACE FUNCTION public.sync_ai_conversation_on_message_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_preview TEXT;
BEGIN
  v_preview := left(regexp_replace(btrim(NEW.content), '\s+', ' ', 'g'), 100);

  UPDATE public.ai_conversations
  SET
    last_message_at = GREATEST(last_message_at, NEW.created_at),
    updated_at = NOW(),
    last_message_preview = v_preview
  WHERE id = NEW.conversation_id
    AND user_id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_ai_messages_sync_conversation ON public.ai_messages;
CREATE TRIGGER trg_ai_messages_sync_conversation
  AFTER INSERT ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_conversation_on_message_insert();

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_conversations_select_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_select_own"
  ON public.ai_conversations
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_conversations_insert_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_insert_own"
  ON public.ai_conversations
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_conversations_update_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_update_own"
  ON public.ai_conversations
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_conversations_delete_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_delete_own"
  ON public.ai_conversations
  FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_messages_select_own" ON public.ai_messages;
CREATE POLICY "ai_messages_select_own"
  ON public.ai_messages
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_messages_insert_own" ON public.ai_messages;
CREATE POLICY "ai_messages_insert_own"
  ON public.ai_messages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_messages_update_own" ON public.ai_messages;
CREATE POLICY "ai_messages_update_own"
  ON public.ai_messages
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_messages_delete_own" ON public.ai_messages;
CREATE POLICY "ai_messages_delete_own"
  ON public.ai_messages
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.ai_conversations c
      WHERE c.id = conversation_id
        AND c.user_id = auth.uid()
    )
  );
