# Supabase Communication Foundation

This directory contains the Phase 1 migration artifacts for Tech Titans communication infrastructure.

## What was added

- `supabase/migrations/20260810_communication_schema.sql`
  - Adds production-ready communication tables:
    - `notifications`
    - `user_devices`
    - `notification_preferences`
    - `calls`
    - `call_participants`
    - `call_events`
  - Extends `announcements` with targeting, priority, and scheduling fields.
  - Adds indexes and `updated_at` triggers.

- `supabase/migrations/20260810_communication_policies.sql`
  - Adds Supabase RLS policies for communication tables.
  - Adds helper functions:
    - `current_user_role()`
    - `is_admin()`
    - `is_call_participant(call_uuid)`
    - `is_announcement_targeted(user_uuid, announcement_target_type, announcement_target_value)`
  - Enables RLS on new and existing messaging tables.

- `.env.example`
  - Adds placeholder variables for Supabase, RTC provider secrets, push keys, and feature flags.

## How to apply

Supabase CLI or the Supabase SQL editor may be used to apply these migrations.

1. Configure environment variables in a local `.env` or CI environment.
2. Apply `20260810_communication_schema.sql` first.
3. Apply `20260810_communication_policies.sql` second.

If using the Supabase SQL editor directly, paste the contents of each file in order.

## Notes

- The migration is intentionally non-destructive: existing tables are preserved and only new columns or new tables are added.
- Policies are scoped to authenticated users and administrators.
- Sensitive operations such as notification creation and RTC token generation must still be handled by a trusted server or edge function.
- No frontend logic has been changed yet.

## Next step

Phase 1 completion will continue with secure backend integration and token-generation architecture, followed by a new notification service and table-backed delivery.

## Phase 2 notification engine

- Frontend notification support now includes a reusable notification center component for dashboard, group chat, and direct message pages.
- The notification center is driven by the `notifications` table and will load recipient-specific notifications when the backend inserts them.
- The UI also shows unread counts and can mark notifications as read.
- Future work: add secure edge functions to create `notifications` rows for messages, calls, and announcements, and add push delivery via `user_devices` and `notification_preferences`.

## Android FCM call notifications

True closed-app Android incoming calls require native Android Firebase Cloud Messaging handling. WebView JavaScript and Supabase Realtime are not reliable when the APK is closed, removed from recents, or the screen is locked.

Backend support added:

- `supabase/migrations/20260812_fcm_call_devices.sql`
  - Adds `push_provider`, `platform`, and `app_version` metadata to `user_devices`.
  - Keeps existing browser Web Push rows as `web_push`.
  - Enables Android APK FCM tokens to be stored as `push_provider = 'fcm'`.

- `supabase/functions/register-fcm-device`
  - Authenticated Android APK endpoint for storing the current installation's FCM token.
  - Request body:
    ```json
    {
      "token": "firebase-device-token",
      "deviceIdentifier": "stable-install-id",
      "platform": "android",
      "appVersion": "1.0.0"
    }
    ```

- `supabase/functions/send-call-notification`
  - Authenticated call notification sender.
  - Reads authoritative call state from `calls` and `call_participants`.
  - Sends only safe call metadata through FCM: call id, call type, room id, caller id, and action.
  - Does not send Agora tokens, Supabase tokens, service-role keys, or the Agora App Certificate.

Required Supabase secrets:

```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<firebase-service-account-json>'
npx supabase secrets set FCM_PROJECT_ID='<firebase-project-id>'
```

Deploy:

```bash
npx supabase functions deploy register-fcm-device
npx supabase functions deploy send-call-notification
```

Android APK requirements still live in the native APK project, which is not present in this repository:

- Add Android notification, microphone, camera, and internet permissions as appropriate.
- Request Android 13+ notification permission.
- Request microphone/camera runtime permissions before accepting calls.
- Register each installation's FCM token by calling `/functions/v1/register-fcm-device` with the logged-in Supabase access token.
- Handle `incoming_call` and `call_cancelled` FCM data messages natively.
- Show an incoming-call notification channel with ringtone, vibration, Accept, and Decline actions.
- On Accept, launch/resume TechTitans, restore the Supabase session, verify the call is still valid, fetch the Agora token, then join the call.
- On Decline, update call state and cancel ringtone/vibration without exposing secrets.
