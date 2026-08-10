import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";

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

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(request, 500, { error: "Device registration is unavailable" });
  }

  const authorization = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, 401, { error: "Authentication is required" });
  }

  let payload: {
    token?: unknown;
    deviceIdentifier?: unknown;
    platform?: unknown;
    appVersion?: unknown;
  };

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(request, 400, { error: "Invalid JSON body" });
  }

  if (typeof payload.token !== "string" || payload.token.length < 20 || payload.token.length > 4096) {
    return jsonResponse(request, 400, { error: "A valid FCM token is required" });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonResponse(request, 401, { error: "Invalid authentication token" });
  }

  const deviceIdentifier = typeof payload.deviceIdentifier === "string" && payload.deviceIdentifier.trim()
    ? payload.deviceIdentifier.trim()
    : payload.token;

  const deviceRecord = {
    user_id: data.user.id,
    device_type: "android",
    browser: "TechTitans Android APK",
    push_token: payload.token,
    device_identifier: deviceIdentifier,
    push_provider: "fcm",
    platform: typeof payload.platform === "string" ? payload.platform.slice(0, 64) : "android",
    app_version: typeof payload.appVersion === "string" ? payload.appVersion.slice(0, 64) : null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  };

  const { data: existingDevice, error: lookupError } = await supabase
    .from("user_devices")
    .select("id")
    .eq("user_id", data.user.id)
    .eq("device_identifier", deviceIdentifier)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    return jsonResponse(request, 500, { error: "Unable to inspect device registration" });
  }

  const { error: saveError } = existingDevice?.id
    ? await supabase.from("user_devices").update(deviceRecord).eq("id", existingDevice.id)
    : await supabase.from("user_devices").insert(deviceRecord);

  if (saveError) {
    return jsonResponse(request, 500, { error: "Unable to save device registration" });
  }

  return jsonResponse(request, 200, { registered: true });
});
