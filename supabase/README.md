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

## Native call notifications

True closed-app mobile incoming calls require native push handling. WebView JavaScript and Supabase Realtime are not reliable when the app is closed, removed from recents, or the screen is locked.

Backend support added:

- `supabase/migrations/20260812_fcm_call_devices.sql`
  - Adds `push_provider`, `platform`, and `app_version` metadata to `user_devices`.
  - Keeps existing browser Web Push rows as `web_push`.
  - Enables Android FCM tokens as `push_provider = 'fcm'`.
  - Enables iOS PushKit VoIP tokens as `push_provider = 'apns_voip'`.

- `supabase/functions/register-fcm-device`
  - Backward-compatible authenticated Android endpoint for storing the current installation's FCM token.

- `supabase/functions/register-call-device`
  - Platform-neutral authenticated endpoint for Android FCM and iOS PushKit VoIP token registration.
  - Stores a hash of the native install secret when `deviceSecret` is supplied, so a closed-app native layer can later prove device identity without storing a password.
  - Request body:
    ```json
    {
      "provider": "fcm",
      "token": "device-push-token",
      "deviceIdentifier": "stable-install-id",
      "deviceSecret": "native-generated-random-secret",
      "platform": "android",
      "appVersion": "1.0.0"
    }
    ```

- `supabase/functions/send-call-notification`
  - Authenticated call notification sender.
  - Reads authoritative call state from `calls` and `call_participants`.
  - Sends only safe call metadata through FCM/APNs: call id, call type, room id, caller id, and action.
  - Does not send Agora tokens, Supabase tokens, service-role keys, or the Agora App Certificate.

- `supabase/functions/call-device-action`
  - Allows a previously registered native device to accept, decline, or cancel a call by presenting its stable install id and native-generated device secret.
  - Uses the existing `calls` and `call_participants` tables as authoritative call state.
  - Does not issue Agora tokens. The web/call UI still fetches Agora tokens from `agora-token` after the app opens.

- `supabase/functions/send-push-notification`
  - Central dispatcher for normal persisted notifications.
  - Reads the authoritative `notifications` row and sends safe payloads to registered `web_push`, `fcm`, and future `apns` devices.
  - Supports direct messages, group messages, announcements, friend/request notifications, resource notifications, and system notifications as rows in `notifications`.
  - Does not send incoming calls through the normal notification channel; calls use `send-call-notification`.

Required Supabase secrets for Android FCM:

```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<firebase-service-account-json>'
npx supabase secrets set FCM_PROJECT_ID='<firebase-project-id>'
```

Required Supabase secrets for iOS PushKit/APNs:

```bash
npx supabase secrets set APNS_TEAM_ID='<apple-team-id>'
npx supabase secrets set APNS_KEY_ID='<apns-key-id>'
npx supabase secrets set APNS_BUNDLE_ID='<ios-app-bundle-id>'
npx supabase secrets set APNS_VOIP_PRIVATE_KEY='<contents-of-apns-auth-key-p8>'
```

For APNs sandbox testing only:

```bash
npx supabase secrets set APNS_USE_SANDBOX='true'
```

Deploy:

```bash
npx supabase functions deploy register-call-device
npx supabase functions deploy register-fcm-device
npx supabase functions deploy send-call-notification
npx supabase functions deploy send-push-notification
npx supabase functions deploy call-device-action
```

Android APK requirements still live in the native APK project, which is not present in this repository:

- Add Android notification, microphone, camera, and internet permissions as appropriate.
- Request Android 13+ notification permission.
- Request microphone/camera runtime permissions before accepting calls.
- Register each installation's FCM token by calling `/functions/v1/register-call-device` with `provider: "fcm"` and the logged-in Supabase access token.
- Handle `incoming_call` and `call_cancelled` FCM data messages natively.
- Show an incoming-call notification channel with ringtone, vibration, Accept, and Decline actions.
- On Accept, launch/resume TechTitans, restore the Supabase session, verify the call is still valid, fetch the Agora token, then join the call.
- On Decline, update call state and cancel ringtone/vibration without exposing secrets.

iOS requirements still live in the native iOS project, which is not present in this repository:

- Register for PushKit VoIP pushes.
- Register each installation's VoIP token by calling `/functions/v1/register-call-device` with `provider: "apns_voip"` and the logged-in Supabase access token.
- Report incoming calls to CallKit immediately when a valid VoIP push arrives.
- Use a unique CallKit UUID per call instance.
- On CallKit Accept, verify the call, restore/open TechTitans, fetch the Agora token, then join the call.
- On CallKit Decline or caller cancellation, end the CallKit call and update TechTitans call state without joining Agora.
