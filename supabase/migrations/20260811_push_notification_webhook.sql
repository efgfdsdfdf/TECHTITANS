-- Supabase migration: auto-trigger push notifications on notification insert
-- Created: 2026-08-11

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_push_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  supabase_url text := 'https://mdqqtsdibtvymfgntstf.supabase.co';
  service_role_key text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL OR service_role_key = '' THEN
    RAISE WARNING 'push_notification_webhook: service_role_key not found in vault';
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    body := jsonb_build_object('notification_id', NEW.id::text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )
  ) INTO request_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_push_on_notification_insert ON public.notifications;
CREATE TRIGGER trigger_push_on_notification_insert
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trigger_push_notification();
