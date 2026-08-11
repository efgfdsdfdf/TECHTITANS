import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

type CallRecord = {
  id: string;
  initiated_by: string;
  type: "voice" | "video";
  status: string;
  room_id: string;
};

type DeviceRecord = {
  id: string;
  push_token: string;
  push_provider: "web_push" | "fcm" | "apns_voip";
};

type ProfileRecord = {
  full_name: string | null;
  avatar_url?: string | null;
};

const allowedHeaders = "authorization, x-client-info, apikey, content-type";
const allowedMethods = "POST, OPTIONS";
const defaultAllowedOrigins = [
  "https://techtitans-snowy.vercel.app",
  "https://efgfdsdfdf.github.io",
  "capacitor://localhost",
  "http://localhost",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function getAllowedOrigins() {
  const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return configuredOrigins.length > 0 ? configuredOrigins : defaultAllowedOrigins;
}

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": allowedMethods,
    "Vary": "Origin",
  };

  if (origin && getAllowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
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

function base64UrlEncode(input: ArrayBuffer | string) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);

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
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function getFcmAccessToken() {
  const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) {
    throw new Error("FCM is not configured");
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
  };

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FCM service account is incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
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
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
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

  const serviceAccount = JSON.parse(serviceAccountJson) as { project_id?: string };
  return serviceAccount.project_id || null;
}

async function getApnsAccessToken() {
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const keyId = Deno.env.get("APNS_KEY_ID");
  const privateKey = Deno.env.get("APNS_VOIP_PRIVATE_KEY");

  if (!teamId || !keyId || !privateKey) {
    throw new Error("APNs is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId };
  const claim = { iss: teamId, iat: now };
  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
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

function buildAndroidMessage(token: string, action: string, call: CallRecord, caller: ProfileRecord | null) {
  const callerName = caller?.full_name || "TechTitans";
  const isCancel = action === "cancelled";
  const callLabel = call.type === "video" ? "video call" : "voice call";

  return {
    token,
    notification: {
      title: isCancel ? "Call ended" : callerName,
      body: isCancel ? "The incoming call has ended." : `Incoming ${callLabel}`,
      image: caller?.avatar_url || undefined,
    },
    data: {
      type: isCancel ? "call_cancelled" : "incoming_call",
      callId: call.id,
      callType: call.type,
      roomId: call.room_id,
      callerId: call.initiated_by,
      callerName,
      action,
    },
    android: {
      priority: "HIGH",
      ttl: "60s",
      notification: {
        channel_id: "incoming_calls",
        sound: "default",
        tag: `call-${call.id}`,
        click_action: "TECHTITANS_INCOMING_CALL",
      },
    },
  };
}

function buildApplePayload(action: string, call: CallRecord, caller: ProfileRecord | null) {
  const callerName = caller?.full_name || "TechTitans";
  const isCancel = action === "cancelled";

  return {
    aps: {
      alert: isCancel
        ? { title: "Call ended", body: "The incoming call has ended." }
        : { title: callerName, body: `Incoming ${call.type} call` },
      sound: "default",
      "content-available": 1,
    },
    type: isCancel ? "call_cancelled" : "incoming_call",
    callId: call.id,
    callType: call.type,
    roomId: call.room_id,
    callerId: call.initiated_by,
    action,
  };
}

function configureWebPush() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@techtitans.app";

  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function buildWebPushPayload(action: string, call: CallRecord, caller: ProfileRecord | null) {
  const callerName = caller?.full_name || "TechTitans";
  const isCancel = action === "cancelled";
  const callLabel = call.type === "video" ? "video call" : "voice call";

  return {
    title: isCancel ? "Call ended" : callerName,
    body: isCancel ? "The incoming call has ended." : `Incoming ${callLabel}`,
    icon: caller?.avatar_url || "img/titans_logo2.png",
    badge: "img/titans_logo2.png",
    tag: `call-${call.id}`,
    requireInteraction: !isCancel,
    url: `dm.html?callId=${encodeURIComponent(call.id)}`,
    data: {
      type: isCancel ? "call_cancelled" : "incoming_call",
      callId: call.id,
      callType: call.type,
      roomId: call.room_id,
      callerId: call.initiated_by,
      callerName,
      action,
      url: `dm.html?callId=${encodeURIComponent(call.id)}`,
    },
    vibrate: isCancel ? [80] : [180, 90, 180, 90, 240],
  };
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse(request, 500, { error: "Call notification service is unavailable" });
  }

  const authorization = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, 401, { error: "Authentication is required" });
  }

  let payload: { callId?: unknown; recipientId?: unknown; action?: unknown };
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(request, 400, { error: "Invalid JSON body" });
  }

  const action = typeof payload.action === "string" ? payload.action : "incoming";
  if (!["incoming", "cancelled"].includes(action)) {
    return jsonResponse(request, 400, { error: "Unsupported call notification action" });
  }
  if (typeof payload.callId !== "string" || typeof payload.recipientId !== "string") {
    return jsonResponse(request, 400, { error: "callId and recipientId are required" });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(request, 401, { error: "Invalid authentication token" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: call, error: callError } = await supabase
    .from("calls")
    .select("id, initiated_by, type, status, room_id")
    .eq("id", payload.callId)
    .single<CallRecord>();

  if (callError || !call) {
    return jsonResponse(request, 404, { error: "Call not found" });
  }

  const { data: senderParticipant } = await supabase
    .from("call_participants")
    .select("id")
    .eq("call_id", call.id)
    .eq("user_id", userData.user.id)
    .maybeSingle<{ id: string }>();

  const senderIsInitiator = call.initiated_by === userData.user.id;
  const senderIsParticipant = Boolean(senderParticipant);
  if (!senderIsInitiator && !senderIsParticipant) {
    return jsonResponse(request, 403, { error: "You are not authorized for this call" });
  }

  const { data: recipientParticipant } = await supabase
    .from("call_participants")
    .select("id")
    .eq("call_id", call.id)
    .eq("user_id", payload.recipientId)
    .maybeSingle<{ id: string }>();

  if (!recipientParticipant && payload.recipientId !== call.initiated_by) {
    return jsonResponse(request, 403, { error: "Recipient is not part of this call" });
  }

  if (action === "incoming" && (!senderIsInitiator || !["ringing", "initiated"].includes(call.status))) {
    return jsonResponse(request, 409, { error: "Call is not ringing" });
  }

  const { data: preference } = await supabase
    .from("notification_preferences")
    .select("push_enabled, incoming_calls_enabled, voice_calls_enabled, video_calls_enabled")
    .eq("user_id", payload.recipientId)
    .maybeSingle<{
      push_enabled: boolean;
      incoming_calls_enabled: boolean;
      voice_calls_enabled: boolean;
      video_calls_enabled: boolean;
    }>();

  if (
    preference &&
    (preference.push_enabled === false ||
      preference.incoming_calls_enabled === false ||
      (call.type === "voice" && preference.voice_calls_enabled === false) ||
      (call.type === "video" && preference.video_calls_enabled === false))
  ) {
    return jsonResponse(request, 200, { sent: 0, skipped: true, reason: "recipient disabled call push" });
  }

  const { data: devices, error: devicesError } = await supabase
    .from("user_devices")
    .select("id, push_token, push_provider")
    .eq("user_id", payload.recipientId)
    .eq("is_active", true)
    .in("push_provider", ["web_push", "fcm", "apns_voip"])
    .returns<DeviceRecord[]>();

  if (devicesError) {
    return jsonResponse(request, 500, { error: "Unable to load recipient devices" });
  }

  if (!devices || devices.length === 0) {
    return jsonResponse(request, 200, { sent: 0, failed: 0, expired: 0 });
  }

  const { data: caller } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", call.initiated_by)
    .maybeSingle<ProfileRecord>();

  let fcmAccessToken: string | null = null;
  let apnsAccessToken: string | null = null;
  const fcmProjectId = getFcmProjectId();
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID");
  const webPushConfigured = configureWebPush();

  let sent = 0;
  let failed = 0;
  let expired = 0;
  let skipped = 0;

  await Promise.all(devices.map(async (device) => {
    try {
      if (device.push_provider === "web_push") {
        if (!webPushConfigured) {
          skipped += 1;
          return;
        }
        await webpush.sendNotification(
          JSON.parse(device.push_token),
          JSON.stringify(buildWebPushPayload(action, call, caller || null)),
        );
        sent += 1;
        return;
      }

      if (device.push_provider === "apns_voip") {
        if (!apnsBundleId) {
          skipped += 1;
          return;
        }
        apnsAccessToken ||= await getApnsAccessToken();
        const response = await fetch(`${getApnsHost()}/3/device/${device.push_token}`, {
          method: "POST",
          headers: {
            "authorization": `bearer ${apnsAccessToken}`,
            "apns-topic": `${apnsBundleId}.voip`,
            "apns-push-type": "voip",
            "apns-priority": "10",
            "apns-expiration": String(Math.floor(Date.now() / 1000) + 60),
          },
          body: JSON.stringify(buildApplePayload(action, call, caller || null)),
        });

        if (response.ok) {
          sent += 1;
          return;
        }

        failed += 1;
        const data = await response.json().catch(() => ({}));
        const reason = String(data.reason || "").toLowerCase();
        if (response.status === 410 || reason.includes("baddevicetoken") || reason.includes("unregistered")) {
          expired += 1;
          await supabase
            .from("user_devices")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", device.id);
        }
        return;
      }

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
          message: buildAndroidMessage(device.push_token, action, call, caller || null),
        }),
      });

      if (response.ok) {
        sent += 1;
        return;
      }

      failed += 1;
      const data = await response.json().catch(() => ({}));
      const errorText = JSON.stringify(data).toLowerCase();
      if (response.status === 404 || errorText.includes("unregistered") || errorText.includes("notregistered")) {
        expired += 1;
        await supabase
          .from("user_devices")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", device.id);
      }
    } catch (_error) {
      failed += 1;
    }
  }));

  return jsonResponse(request, 200, { sent, failed, expired, skipped });
});
