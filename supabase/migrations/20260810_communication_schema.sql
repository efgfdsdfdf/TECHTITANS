-- Supabase migration: communication foundation for Tech Titans
-- Created: 2026-08-10

-- 1. Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id),
  actor_id uuid REFERENCES public.profiles(id),
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_type text,
  entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON public.notifications (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON public.notifications (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at);

-- 2. User devices for push registration
CREATE TABLE IF NOT EXISTS public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  device_type text NOT NULL,
  browser text,
  push_token text NOT NULL,
  device_identifier text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_push_token ON public.user_devices (push_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_device_identifier
  ON public.user_devices (user_id, device_identifier)
  WHERE device_identifier IS NOT NULL;

-- 3. Notification preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id),
  messages_enabled boolean NOT NULL DEFAULT true,
  voice_calls_enabled boolean NOT NULL DEFAULT true,
  video_calls_enabled boolean NOT NULL DEFAULT true,
  announcements_enabled boolean NOT NULL DEFAULT true,
  company_announcements_enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT true,
  incoming_calls_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Calls metadata
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by uuid NOT NULL,
  conversation_id uuid,
  type text NOT NULL CHECK (type IN ('voice', 'video')),
  status text NOT NULL CHECK (status IN ('initiated', 'ringing', 'active', 'ended', 'declined', 'missed', 'failed', 'cancelled')),
  room_id text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_initiated_by ON public.calls (initiated_by);
CREATE INDEX IF NOT EXISTS idx_calls_conversation_id ON public.calls (conversation_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls (created_at);

ALTER TABLE IF EXISTS public.calls
  ADD COLUMN IF NOT EXISTS initiated_by uuid,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS room_id text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- 5. Call participants
CREATE TABLE IF NOT EXISTS public.call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL CHECK (status IN ('invited', 'ringing', 'accepted', 'joined', 'declined', 'missed', 'left', 'removed')),
  joined_at timestamptz,
  left_at timestamptz,
  duration_seconds integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_call_participants_call_id ON public.call_participants (call_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_user_id ON public.call_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_status ON public.call_participants (status);

ALTER TABLE IF EXISTS public.call_participants
  ADD COLUMN IF NOT EXISTS joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_seconds integer DEFAULT 0;

-- 6. Call events
CREATE TABLE IF NOT EXISTS public.call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('call_created', 'call_ringing', 'call_accepted', 'participant_joined', 'participant_left', 'participant_removed', 'call_declined', 'call_ended', 'call_failed')),
  user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_events_call_id ON public.call_events (call_id);
CREATE INDEX IF NOT EXISTS idx_call_events_event_type ON public.call_events (event_type);

ALTER TABLE IF EXISTS public.call_events
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- 7. Announcement enhancements
ALTER TABLE IF EXISTS public.announcements
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS target_value jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_announcements_target_type ON public.announcements (target_type);
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON public.announcements (priority);
CREATE INDEX IF NOT EXISTS idx_announcements_published_at ON public.announcements (published_at);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled_for ON public.announcements (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON public.announcements (expires_at);

-- 8. Notification preference defaults for existing users
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.notification_preferences)
ON CONFLICT DO NOTHING;

-- 9. Trigger updated_at on user_devices and notification_preferences
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_user_devices_updated_at ON public.user_devices;
CREATE TRIGGER trigger_user_devices_updated_at
BEFORE UPDATE ON public.user_devices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trigger_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
