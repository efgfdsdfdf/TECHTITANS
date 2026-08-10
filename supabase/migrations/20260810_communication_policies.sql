-- Supabase migration: communication RLS and helper functions
-- Created: 2026-08-10

-- 1. Utility functions
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_call_participant(call_uuid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  is_participant boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'call_participants'
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1
      FROM public.call_participants cp
      WHERE cp.call_id = $1
        AND cp.user_id = auth.uid()
    )'
    INTO is_participant
    USING call_uuid;
  END IF;

  RETURN is_participant;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_announcement_targeted(user_uuid uuid, announcement_target_type text, announcement_target_value jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  required_role text;
BEGIN
  IF announcement_target_type IS NULL OR announcement_target_type = 'everyone' THEN
    RETURN TRUE;
  ELSIF announcement_target_type = 'users' THEN
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(announcement_target_value) AS uid
      WHERE uid::uuid = user_uuid
    );
  ELSIF announcement_target_type = 'role' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_uuid
        AND p.role = ANY (SELECT jsonb_array_elements_text(announcement_target_value))
    );
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;

-- 2. Enable RLS and policies for new tables
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select_recipient ON public.notifications FOR SELECT USING (
  recipient_id = auth.uid()
);
CREATE POLICY notifications_update_self ON public.notifications FOR UPDATE USING (
  recipient_id = auth.uid()
) WITH CHECK (
  recipient_id = auth.uid()
);
CREATE POLICY notifications_delete_self ON public.notifications FOR DELETE USING (
  recipient_id = auth.uid()
);
-- Insert must be handled by a secure backend or Supabase service role.
-- Use the trusted function public.enqueue_notification() or a server-side edge function
-- so that notifications can be created while RLS prevents anonymous inserts.

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_devices_select_own ON public.user_devices FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY user_devices_insert_own ON public.user_devices FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY user_devices_update_own ON public.user_devices FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY user_devices_delete_own ON public.user_devices FOR DELETE USING (
  user_id = auth.uid()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_select_own ON public.notification_preferences FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY notification_preferences_insert_own ON public.notification_preferences FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY notification_preferences_update_own ON public.notification_preferences FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY calls_select_participant ON public.calls FOR SELECT USING (
  initiated_by = auth.uid()
  OR public.is_call_participant(id)
);
CREATE POLICY calls_insert_originator ON public.calls FOR INSERT WITH CHECK (
  initiated_by = auth.uid()
);
CREATE POLICY calls_update_participant ON public.calls FOR UPDATE USING (
  initiated_by = auth.uid()
  OR public.is_call_participant(id)
) WITH CHECK (
  initiated_by = auth.uid()
  OR public.is_call_participant(id)
);
CREATE POLICY calls_delete_originator ON public.calls FOR DELETE USING (
  initiated_by = auth.uid()
);

ALTER TABLE public.call_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_participants_select_related ON public.call_participants FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_call_participant(call_id)
);
CREATE POLICY call_participants_insert_self ON public.call_participants FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.id = call_id
      AND c.initiated_by = auth.uid()
  )
);
CREATE POLICY call_participants_update_self_status ON public.call_participants FOR UPDATE USING (
  user_id = auth.uid()
) WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY call_participants_delete_self ON public.call_participants FOR DELETE USING (
  user_id = auth.uid()
);

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_events_select_participant ON public.call_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.id = call_id
      AND (c.initiated_by = auth.uid() OR public.is_call_participant(c.id))
  )
);
CREATE POLICY call_events_insert_self ON public.call_events FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.id = call_id
      AND (c.initiated_by = auth.uid() OR public.is_call_participant(c.id))
  )
);

-- 3. Announcement security and admin controls
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_select_visible ON public.announcements FOR SELECT USING (
  (
    published_at IS NOT NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND public.is_announcement_targeted(auth.uid(), target_type, target_value)
  )
  OR created_by = auth.uid()
  OR public.is_admin()
);
CREATE POLICY announcements_insert_admin ON public.announcements FOR INSERT WITH CHECK (
  public.is_admin()
);
CREATE POLICY announcements_update_admin ON public.announcements FOR UPDATE USING (
  public.is_admin()
) WITH CHECK (
  public.is_admin()
);
CREATE POLICY announcements_delete_admin ON public.announcements FOR DELETE USING (
  public.is_admin()
);

-- 4. Existing messaging tables security
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_messages_select_role ON public.group_messages FOR SELECT USING (
  sender_id = auth.uid()
  OR role = public.current_user_role()
);
CREATE POLICY group_messages_insert_sender ON public.group_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
);
CREATE POLICY group_messages_update_sender ON public.group_messages FOR UPDATE USING (
  sender_id = auth.uid()
) WITH CHECK (
  sender_id = auth.uid()
);
CREATE POLICY group_messages_delete_sender ON public.group_messages FOR DELETE USING (
  sender_id = auth.uid()
);

ALTER TABLE public.private_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY private_messages_select_conversation ON public.private_messages FOR SELECT USING (
  sender_id = auth.uid()
  OR recipient_id = auth.uid()
);
CREATE POLICY private_messages_insert_sender ON public.private_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
);
CREATE POLICY private_messages_update_own ON public.private_messages FOR UPDATE USING (
  sender_id = auth.uid()
  OR recipient_id = auth.uid()
) WITH CHECK (
  auth.uid() = sender_id
  OR (
    auth.uid() = recipient_id
    AND old.content = new.content
    AND old.sender_id = new.sender_id
    AND old.recipient_id = new.recipient_id
  )
);
CREATE POLICY private_messages_delete_sender ON public.private_messages FOR DELETE USING (
  sender_id = auth.uid()
);

ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_reads_select_owner ON public.message_reads FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.private_messages pm
    WHERE pm.id = message_id
      AND pm.sender_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.group_messages gm
    WHERE gm.id = message_id
      AND gm.sender_id = auth.uid()
  )
);
CREATE POLICY message_reads_insert_owner ON public.message_reads FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY message_reads_delete_owner ON public.message_reads FOR DELETE USING (
  user_id = auth.uid()
);
