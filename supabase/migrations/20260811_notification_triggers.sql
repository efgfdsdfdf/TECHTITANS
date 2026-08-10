-- Supabase migration: notification delivery triggers for Tech Titans
-- Created: 2026-08-11

-- 1. Notification enqueue helper
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  recipient_uuid uuid,
  actor_uuid uuid,
  notif_type text,
  title_text text,
  body_text text,
  entity_type text,
  entity_id uuid,
  payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET row_security = off AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    type,
    title,
    body,
    data,
    entity_type,
    entity_id
  ) VALUES (
    recipient_uuid,
    actor_uuid,
    notif_type,
    title_text,
    body_text,
    payload,
    entity_type,
    entity_id
  );
END;
$$;

-- 2. Notify user on new private message
CREATE OR REPLACE FUNCTION public.notify_private_message()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  message_body text;
BEGIN
  IF NEW.sender_id IS NULL OR NEW.recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id = NEW.recipient_id THEN
    RETURN NEW;
  END IF;

  message_body := COALESCE(NULLIF(NEW.content, ''), 'Sent a voice note');

  IF EXISTS (
    SELECT 1
    FROM public.notification_preferences np
    WHERE np.user_id = NEW.recipient_id
      AND np.messages_enabled
  ) THEN
    PERFORM public.enqueue_notification(
      NEW.recipient_id,
      NEW.sender_id,
      'private_message',
      'New direct message',
      message_body,
      'private_messages',
      NEW.id,
      jsonb_build_object('url', 'dm.html', 'message_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_private_message ON public.private_messages;
CREATE TRIGGER trigger_notify_private_message
AFTER INSERT ON public.private_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_private_message();

-- 3. Notify relevant users on new group message
CREATE OR REPLACE FUNCTION public.notify_group_message()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    type,
    title,
    body,
    data,
    entity_type,
    entity_id
  )
  SELECT p.id,
         NEW.sender_id,
         'group_message',
         'New group message',
         COALESCE(NULLIF(NEW.content, ''), 'Sent a voice note'),
         jsonb_build_object('url', 'messages.html', 'role', NEW.role, 'message_id', NEW.id),
         'group_messages',
         NEW.id
  FROM public.profiles p
  LEFT JOIN public.notification_preferences np ON np.user_id = p.id
  WHERE p.id <> NEW.sender_id
    AND (
      NEW.role = 'everyone'
      OR p.job_role = NEW.role
    )
    AND coalesce(np.messages_enabled, true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_group_message ON public.group_messages;
CREATE TRIGGER trigger_notify_group_message
AFTER INSERT ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_group_message();

-- 4. Notify targeted users on new announcement
CREATE OR REPLACE FUNCTION public.notify_announcement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    type,
    title,
    body,
    data,
    entity_type,
    entity_id
  )
  SELECT p.id,
         NEW.created_by,
         'announcement',
         'New announcement',
         COALESCE(NULLIF(NEW.content, ''), 'View the latest announcement'),
         jsonb_build_object('url', 'dashboard.html', 'announcement_id', NEW.id),
         'announcements',
         NEW.id
  FROM public.profiles p
  LEFT JOIN public.notification_preferences np ON np.user_id = p.id
  WHERE p.id <> NEW.created_by
    AND (
      NEW.target_type IS NULL
      OR NEW.target_type = 'everyone'
      OR (
        NEW.target_type = 'role'
        AND p.job_role IN (
          SELECT jsonb_array_elements_text(NEW.target_value)
        )
      )
      OR (
        NEW.target_type = 'users'
        AND p.id IN (
          SELECT jsonb_array_elements_text(NEW.target_value)::uuid
        )
      )
    )
    AND coalesce(np.announcements_enabled, true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_announcement ON public.announcements;
CREATE TRIGGER trigger_notify_announcement
AFTER INSERT ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.notify_announcement();

-- 5. Notify invited call participants
CREATE OR REPLACE FUNCTION public.notify_call_participant_invite()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  call_label text;
BEGIN
  IF NEW.status <> 'invited' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(type, 'call') INTO call_label FROM public.calls WHERE id = NEW.call_id;

  PERFORM public.enqueue_notification(
    NEW.user_id,
    NEW.user_id,
    'call_invite',
    'Incoming call',
    'You have been invited to join a ' || call_label || ' call',
    'calls',
    NEW.call_id,
    jsonb_build_object('url', 'dm.html', 'call_id', NEW.call_id)
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'call_participants'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_notify_call_participant_invite ON public.call_participants;
    CREATE TRIGGER trigger_notify_call_participant_invite
    AFTER INSERT ON public.call_participants
    FOR EACH ROW EXECUTE FUNCTION public.notify_call_participant_invite();
  END IF;
END;
$$;

-- 6. Notify relevant users on call status events
CREATE OR REPLACE FUNCTION public.notify_call_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recipient_uuid uuid;
  caller_name text := COALESCE(NEW.metadata->> 'callerName', 'Your');
  call_type text := COALESCE(NEW.metadata->> 'callType', 'voice');
  call_title text;
  call_body text;
  call_initiator uuid;
BEGIN
  IF NEW.event_type NOT IN ('call_declined', 'call_ended') THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'call_declined' THEN
    call_title := 'Missed call';
    call_body := caller_name || ' call was missed or declined';

    SELECT initiated_by INTO call_initiator
    FROM public.calls
    WHERE id = NEW.call_id;

    IF call_initiator IS NOT NULL THEN
      PERFORM public.enqueue_notification(
        call_initiator,
        NEW.user_id,
        'missed_call',
        call_title,
        call_body,
        'calls',
        NEW.call_id,
        jsonb_build_object('url', 'dm.html', 'call_id', NEW.call_id, 'call_type', call_type)
      );
    END IF;
  ELSE
    call_title := 'Call ended';
    call_body := caller_name || ' call has ended';

    FOR recipient_uuid IN
      SELECT cp.user_id
      FROM public.call_participants cp
      WHERE cp.call_id = NEW.call_id
        AND cp.user_id <> NEW.user_id
    LOOP
      PERFORM public.enqueue_notification(
        recipient_uuid,
        NEW.user_id,
        'call_ended',
        call_title,
        call_body,
        'calls',
        NEW.call_id,
        jsonb_build_object('url', 'dm.html', 'call_id', NEW.call_id, 'call_type', call_type)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'call_events'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_notify_call_event ON public.call_events;
    CREATE TRIGGER trigger_notify_call_event
    AFTER INSERT ON public.call_events
    FOR EACH ROW EXECUTE FUNCTION public.notify_call_event();
  END IF;
END;
$$;
