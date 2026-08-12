import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

type NotificationRecord = {
  id: string;
  recipient_id: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  type: string;
};

type DeviceRecord = {
  id: string;
  push_token: string;
  push_provider: "web_push" | "fcm" | "apns" | "apns_voip";
};

const allowedHeaders = "authorization, x-client-info, apikey, content-type, x-push-webhook-secret";
const allowedMethods = "POST, OPTIONS";
const defaultAllowedOrigins = [
  "https://techtitans-snowy.vercel.app",
  "https://efgfdsdfdf.github.io",
  "capacitor://localhost",
  "http://localhost",
];

function getCorsHeaders(_request: Request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": allowedMethods,
  };
}

function jsonResponse(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

function isAuthorized(request: Request) {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  const authorization = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const requestSecret = request.headers.get("x-push-webhook-secret");

  const cleanAuth = authorization.replace(/^Bearer\s+/i, "").trim();
  const cleanServiceKey = (serviceRoleKey || "").trim();

  if (cleanServiceKey && cleanAuth === cleanServiceKey) return true;
  if (webhookSecret && requestSecret === webhookSecret) return true;
  return false;
}

function getNotificationId(payload: Record<string, unknown>) {
  const directId = payload.notification_id;
  if (typeof directId === "string") return directId;

  const record = payload.record;
  if (record && typeof record === "object" && "id" in record && typeof record.id === "string") {
    return record.id;
  }

  return null;
}

function getTargetUrl(notification: NotificationRecord) {
  const url = notification.data?.url;
  return typeof url === "string" && url.length > 0 ? url : "/";
}

function getNotificationType(notification: NotificationRecord) {
  if (notification.type === "private_message" || notification.type === "group_message") return "message";
  if (notification.type.includes("announcement")) return "announcement";
  if (notification.type.includes("resource")) return "resource";
  if (notification.type.includes("friend")) return "friend_request";
  if (notification.type.includes("call")) return notification.type;
  return "system";
}

function safePayload(notification: NotificationRecord) {
  const data = notification.data || {};
  return {
    notificationId: notification.id,
    type: getNotificationType(notification),
    notificationType: notification.type,
    url: getTargetUrl(notification),
    messageId: typeof data.message_id === "string" ? data.message_id : "",
    conversationId: typeof data.conversation_id === "string" ? data.conversation_id : "",
    announcementId: typeof data.announcement_id === "string" ? data.announcement_id : "",
    resourceId: typeof data.resource_id === "string" ? data.resource_id : "",
    actorId: typeof data.actor_id === "string" ? data.actor_id : "",
  };
}

function base64UrlEncode(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function getFcmAccessToken() {
  const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) throw new Error("FCM is not configured");

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
  };
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FCM service account is incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64UrlEncode(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })),
  ].join(".");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${base64UrlEncode(signature)}`,
    }),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error("Unable to obtain FCM access token");
  }
  return data.access_token as string;
}

function getFcmProjectId() {
  const explicitProjectId = Deno.env.get("FCM_PROJECT_ID");
  if (explicitProjectId) return explicitProjectId;
  const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) return null;
  return (JSON.parse(serviceAccountJson) as { project_id?: string }).project_id || null;
}

async function getApnsAccessToken() {
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const privateKey = Deno.env.get("APNS_PRIVATE_KEY") || Deno.env.get("APNS_VOIP_PRIVATE_KEY");
  if (!teamId || !keyId || !privateKey) throw new Error("APNs is not configured");

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64UrlEncode(JSON.stringify({ alg: "ES256", kid: keyId })),
    base64UrlEncode(JSON.stringify({ iss: teamId, iat: now })),
  ].join(".");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  return `${unsignedJwt}.${base64UrlEncode(signature)}`;
}

function getApnsHost() {
  return Deno.env.get("APNS_USE_SANDBOX") === "true"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return jsonResponse(request, 401, { error: "Unauthorized push request" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("PUSH_PUBLIC_KEY");
  const privateKey = Deno.env.get("PUSH_PRIVATE_KEY");
  const subject = Deno.env.get("PUSH_SUBJECT") || "mailto:admin@techtitans.local";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, 500, { error: "Push server configuration is unavailable" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(request, 400, { error: "Invalid JSON body" });
  }

  const notificationId = getNotificationId(payload);
  if (!notificationId) {
    return jsonResponse(request, 400, { error: "notification_id or record.id is required" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .select("id, recipient_id, title, body, data, type")
    .eq("id", notificationId)
    .single<NotificationRecord>();

  if (notificationError || !notification) {
    return jsonResponse(request, 404, { error: "Notification not found" });
  }

  const { data: preference } = await supabase
    .from("notification_preferences")
    .select("push_enabled")
    .eq("user_id", notification.recipient_id)
    .maybeSingle<{ push_enabled: boolean }>();

  if (preference && preference.push_enabled === false) {
    return jsonResponse(request, 200, { sent: 0, skipped: true, reason: "push disabled" });
  }

  const { data: devices, error: devicesError } = await supabase
    .from("user_devices")
    .select("id, push_token, push_provider")
    .eq("user_id", notification.recipient_id)
    .eq("is_active", true)
    .in("push_provider", ["web_push", "fcm", "apns"])
    .returns<DeviceRecord[]>();

  if (devicesError) {
    return jsonResponse(request, 500, { error: "Unable to load recipient devices" });
  }

  if (!devices || devices.length === 0) {
    return jsonResponse(request, 200, { sent: 0, failed: 0, expired: 0, skipped: 0 });
  }

  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  const title = notification.title || "TechTitans";
  const bodyText = notification.body || "New activity";
  const data = safePayload(notification);
  const webPushBody = JSON.stringify({
    title,
    body: bodyText,
    url: data.url,
    data,
  });

  const fcmProjectId = getFcmProjectId();
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID");
  let fcmAccessToken: string | null = null;
  let apnsAccessToken: string | null = null;
  let sent = 0;
  let failed = 0;
  let expired = 0;
  let skipped = 0;

  await Promise.all(devices.map(async (device) => {
    try {
      if (device.push_provider === "web_push") {
        if (!publicKey || !privateKey) {
          skipped += 1;
          return;
        }
        await webpush.sendNotification(JSON.parse(device.push_token), webPushBody);
        sent += 1;
        return;
      }

      if (device.push_provider === "fcm") {
        if (!fcmProjectId) {
          skipped += 1;
          return;
        }
        fcmAccessToken ||= await getFcmAccessToken();
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${fcmAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: device.push_token,
              notification: { title, body: bodyText },
              data,
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: "techtitans_notifications",
                  sound: "default",
                  tag: `notification-${notification.id}`,
                  click_action: "TECHTITANS_NOTIFICATION",
                },
              },
            },
          }),
        });
        if (response.ok) {
          sent += 1;
          return;
        }
        failed += 1;
        const errorData = await response.json().catch(() => ({}));
        const errorText = JSON.stringify(errorData).toLowerCase();
        if (response.status === 404 || errorText.includes("unregistered") || errorText.includes("notregistered")) {
          expired += 1;
          await supabase.from("user_devices").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
        }
        return;
      }

      if (device.push_provider === "apns") {
        if (!apnsBundleId) {
          skipped += 1;
          return;
        }
        apnsAccessToken ||= await getApnsAccessToken();
        const response = await fetch(`${getApnsHost()}/3/device/${device.push_token}`, {
          method: "POST",
          headers: {
            "authorization": `bearer ${apnsAccessToken}`,
            "apns-topic": apnsBundleId,
            "apns-push-type": "alert",
            "apns-priority": "10",
          },
          body: JSON.stringify({
            aps: {
              alert: { title, body: bodyText },
              sound: "default",
            },
            ...data,
          }),
        });
        if (response.ok) {
          sent += 1;
          return;
        }
        failed += 1;
        const errorData = await response.json().catch(() => ({}));
        const reason = String(errorData.reason || "").toLowerCase();
        if (response.status === 410 || reason.includes("baddevicetoken") || reason.includes("unregistered")) {
          expired += 1;
          await supabase.from("user_devices").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
        }
      }
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        expired += 1;
        await supabase.from("user_devices").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
      }
    }
  }));

  return jsonResponse(request, 200, { sent, failed, expired, skipped });
});
