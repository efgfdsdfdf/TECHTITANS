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
};

const allowedHeaders = "authorization, x-client-info, apikey, content-type, x-push-webhook-secret";
const allowedMethods = "POST, OPTIONS";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": allowedHeaders,
      "Access-Control-Allow-Methods": allowedMethods,
    },
  });
}

function isAuthorized(request: Request) {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  const authorization = request.headers.get("Authorization") || request.headers.get("authorization");
  const requestSecret = request.headers.get("x-push-webhook-secret");

  if (serviceRoleKey && authorization === `Bearer ${serviceRoleKey}`) return true;
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

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": allowedHeaders,
        "Access-Control-Allow-Methods": allowedMethods,
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (!isAuthorized(request)) {
    return jsonResponse(401, { error: "Unauthorized push request" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("PUSH_PUBLIC_KEY");
  const privateKey = Deno.env.get("PUSH_PRIVATE_KEY");
  const subject = Deno.env.get("PUSH_SUBJECT") || "mailto:admin@techtitans.local";

  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey) {
    return jsonResponse(500, { error: "Push server configuration is unavailable" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const notificationId = getNotificationId(payload);
  if (!notificationId) {
    return jsonResponse(400, { error: "notification_id or record.id is required" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .select("id, recipient_id, title, body, data, type")
    .eq("id", notificationId)
    .single<NotificationRecord>();

  if (notificationError || !notification) {
    return jsonResponse(404, { error: "Notification not found" });
  }

  const { data: preference } = await supabase
    .from("notification_preferences")
    .select("push_enabled")
    .eq("user_id", notification.recipient_id)
    .maybeSingle<{ push_enabled: boolean }>();

  if (preference && preference.push_enabled === false) {
    return jsonResponse(200, { sent: 0, skipped: true, reason: "push disabled" });
  }

  const { data: devices, error: devicesError } = await supabase
    .from("user_devices")
    .select("id, push_token")
    .eq("user_id", notification.recipient_id)
    .eq("is_active", true)
    .returns<DeviceRecord[]>();

  if (devicesError) {
    return jsonResponse(500, { error: "Unable to load recipient devices" });
  }

  if (!devices || devices.length === 0) {
    return jsonResponse(200, { sent: 0, failed: 0, expired: 0 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const body = JSON.stringify({
    title: notification.title || "Tech Titans",
    body: notification.body || "New activity",
    url: getTargetUrl(notification),
    data: {
      notification_id: notification.id,
      type: notification.type,
      ...notification.data,
    },
  });

  let sent = 0;
  let failed = 0;
  let expired = 0;

  await Promise.all(devices.map(async (device) => {
    try {
      const subscription = JSON.parse(device.push_token);
      await webpush.sendNotification(subscription, body);
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;

      if (statusCode === 404 || statusCode === 410) {
        expired += 1;
        await supabase
          .from("user_devices")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", device.id);
      }
    }
  }));

  return jsonResponse(200, { sent, failed, expired });
});
