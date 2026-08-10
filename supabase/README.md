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
