-- Supabase migration: Android FCM call notification device metadata
-- Created: 2026-08-12

ALTER TABLE IF EXISTS public.user_devices
  ADD COLUMN IF NOT EXISTS push_provider text NOT NULL DEFAULT 'web_push',
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS device_secret_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_devices_push_provider_check'
      AND conrelid = to_regclass('public.user_devices')
  ) THEN
    ALTER TABLE public.user_devices
      DROP CONSTRAINT user_devices_push_provider_check;
  END IF;

  IF to_regclass('public.user_devices') IS NOT NULL THEN
    ALTER TABLE public.user_devices
      ADD CONSTRAINT user_devices_push_provider_check
      CHECK (push_provider IN ('web_push', 'fcm', 'apns', 'apns_voip'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_devices_fcm_active
  ON public.user_devices (user_id, push_provider, is_active)
  WHERE push_provider = 'fcm';

CREATE INDEX IF NOT EXISTS idx_user_devices_apns_voip_active
  ON public.user_devices (user_id, push_provider, is_active)
  WHERE push_provider = 'apns_voip';

CREATE INDEX IF NOT EXISTS idx_user_devices_apns_active
  ON public.user_devices (user_id, push_provider, is_active)
  WHERE push_provider = 'apns';
