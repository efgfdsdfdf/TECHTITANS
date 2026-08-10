-- Supabase migration: Android FCM call notification device metadata
-- Created: 2026-08-12

ALTER TABLE IF EXISTS public.user_devices
  ADD COLUMN IF NOT EXISTS push_provider text NOT NULL DEFAULT 'web_push',
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS app_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_devices_push_provider_check'
      AND conrelid = to_regclass('public.user_devices')
  ) THEN
    ALTER TABLE public.user_devices
      ADD CONSTRAINT user_devices_push_provider_check
      CHECK (push_provider IN ('web_push', 'fcm'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_devices_fcm_active
  ON public.user_devices (user_id, push_provider, is_active)
  WHERE push_provider = 'fcm';
