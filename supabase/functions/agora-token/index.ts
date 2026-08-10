import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";
import { RtcRole, RtcTokenBuilder } from "npm:agora-access-token@2.0.4";

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
  const allowedOrigins = getAllowedOrigins();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Allow-Methods": allowedMethods,
    "Vary": "Origin",
  };

  if (origin && allowedOrigins.includes(origin)) {
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

function isValidChannelName(channelName: string) {
  const byteLength = new TextEncoder().encode(channelName).length;
  return /^(dm|group)_[A-Za-z0-9_-]+$/.test(channelName) && byteLength > 0 && byteLength < 64;
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const appId = Deno.env.get("AGORA_APP_ID");
  const appCertificate = Deno.env.get("AGORA_APP_CERTIFICATE");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!appId || !appCertificate || !supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(request, 500, { error: "Agora server configuration is unavailable" });
  }

  const authorization = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, 401, { error: "Authentication is required" });
  }

  let payload: { channelName?: unknown; uid?: unknown };
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(request, 400, { error: "Invalid JSON body" });
  }

  const { channelName, uid } = payload;
  if (typeof channelName !== "string" || typeof uid !== "string") {
    return jsonResponse(request, 400, { error: "channelName and uid are required" });
  }

  if (!isValidChannelName(channelName)) {
    return jsonResponse(request, 400, { error: "Invalid Agora channel name" });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authorization },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonResponse(request, 401, { error: "Invalid authentication token" });
  }

  if (data.user.id !== uid) {
    return jsonResponse(request, 403, { error: "Requested uid does not match authenticated user" });
  }

  try {
    const expirationTimestamp = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithAccount(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expirationTimestamp,
    );

    return jsonResponse(request, 200, { token });
  } catch (_error) {
    return jsonResponse(request, 500, { error: "Unable to generate Agora token" });
  }
});
