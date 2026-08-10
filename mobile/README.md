# TechTitans Capacitor Mobile Shell

This repository now contains a real Capacitor Android project around the existing TechTitans web application.

The web UI remains the primary application layer. Native Android is responsible only for capabilities that cannot reliably run from WebView JavaScript when the app is closed or backgrounded:

- Firebase Cloud Messaging token ownership
- persistent install identity and device secret
- native incoming-call notification channel
- separate normal notification channel for messages, announcements, resources, requests, and system notifications
- ringtone and vibration
- Accept and Decline notification actions
- call cancellation notification cleanup
- Android notification, microphone, and camera permission requests
- WebView microphone/camera permission support through Capacitor
- native-to-WebView handoff after Accept

## Android Setup

1. Create a Firebase Android app with package name:

   ```text
   com.techtitans.app
   ```

2. Download `google-services.json` from Firebase and place it at:

   ```text
   android/app/google-services.json
   ```

   Do not commit the real file. `android/app/google-services.example.json` shows the expected shape.

3. Configure backend FCM secrets in Supabase:

   ```bash
   npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<firebase-service-account-json>'
   npx supabase secrets set FCM_PROJECT_ID='<firebase-project-id>'
   npx supabase functions deploy send-call-notification
   ```

4. Build web assets and sync Capacitor:

   ```bash
   npm run cap:sync
   ```

5. Generate a debug APK:

   ```bash
   cd android
   gradlew.bat assembleDebug
   ```

   Output:

   ```text
   android/app/build/outputs/apk/debug/app-debug.apk
   ```

6. Generate a release AAB:

   ```bash
   cd android
   gradlew.bat bundleRelease
   ```

   Output:

   ```text
   android/app/build/outputs/bundle/release/app-release.aab
   ```

## Native/Web Bridge

Web to native:

- `TechTitansCall.registerCallDevice({ supabaseUrl, accessToken })`
- `TechTitansCall.requestCallPermissions()`
- `TechTitansCall.stopIncomingCall({ callId })`
- `TechTitansCall.getPendingCallAction()`
- `TechTitansCall.getPendingNotificationAction()`

Native to web:

- Native Accept launches/resumes TechTitans.
- `native-bridge.js` consumes pending native call actions.
- Accepted calls route to:

  ```text
  dm.html?callId=<id>&nativeAccepted=1&callType=<voice|video>
  ```

The web app still obtains the Agora RTC token from `supabase/functions/agora-token/index.ts`.

## Notification Routing

Normal notifications and incoming calls are intentionally separate:

- Messages, group messages, announcements, friend requests, resources, and system notifications use the `techtitans_notifications` Android channel.
- Incoming voice/video calls use the `incoming_calls` Android channel and high-priority call actions.
- Incoming calls are not shown as ordinary message notifications.

Normal notification payloads contain only safe routing data such as:

```json
{
  "type": "message",
  "notificationId": "...",
  "messageId": "...",
  "conversationId": "...",
  "url": "dm.html?user=..."
}
```

The app loads the real message or announcement from Supabase after opening.

## Security

The Android project must not contain:

- Agora App Certificate
- Supabase service-role key
- Firebase service-account private key
- Agora RTC tokens

`AGORA_APP_CERTIFICATE` remains exclusively server-side in:

```text
supabase/functions/agora-token/index.ts
```

## iOS Later

The backend now supports `push_provider = 'apns_voip'` for future iOS PushKit registration. The iOS native target still needs to be created later with:

- APNs / PushKit
- CallKit
- native microphone/camera permissions
- Agora join after secure token fetch

Do not implement iOS incoming calls with WebView notifications.
