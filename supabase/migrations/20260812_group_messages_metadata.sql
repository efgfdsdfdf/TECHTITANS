-- Add metadata column to group_messages for reply context
-- Fixes "Could not find the 'metadata' column of 'group_messages' in the schema cache"

ALTER TABLE IF EXISTS public.group_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;

-- Ask PostgREST to reload its schema cache so the new column is visible immediately
NOTIFY pgrst, 'reload schema';
