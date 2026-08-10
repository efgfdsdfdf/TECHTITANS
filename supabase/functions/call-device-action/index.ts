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

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, 500, { error: "Call action service is unavailable" });
  }

  let payload: {
    action?: unknown;
    callId?: unknown;
    deviceIdentifier?: unknown;
    deviceSecret?: unknown;
  };

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(request, 400, { error: "Invalid JSON body" });
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  if (!["accept", "decline", "cancel"].includes(action)) {
    return jsonResponse(request, 400, { error: "Unsupported call action" });
  }
  if (
    typeof payload.callId !== "string" ||
    typeof payload.deviceIdentifier !== "string" ||
    typeof payload.deviceSecret !== "string"
  ) {
    return jsonResponse(request, 400, { error: "callId, deviceIdentifier, and deviceSecret are required" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const deviceSecretHash = await sha256Hex(payload.deviceSecret);
  const { data: device, error: deviceError } = await supabase
    .from("user_devices")
    .select("id, user_id, is_active")
    .eq("device_identifier", payload.deviceIdentifier)
    .eq("device_secret_hash", deviceSecretHash)
    .eq("is_active", true)
    .maybeSingle<{ id: string; user_id: string; is_active: boolean }>();

  if (deviceError || !device) {
    return jsonResponse(request, 401, { error: "Device is not registered for call actions" });
  }

  const { data: participant } = await supabase
    .from("call_participants")
    .select("id, status")
    .eq("call_id", payload.callId)
    .eq("user_id", device.user_id)
    .maybeSingle<{ id: string; status: string }>();

  if (!participant) {
    return jsonResponse(request, 403, { error: "Device user is not a call participant" });
  }

  const { data: call } = await supabase
    .from("calls")
    .select("id, initiated_by, type, status, room_id")
    .eq("id", payload.callId)
    .maybeSingle<{ id: string; initiated_by: string; type: string; status: string; room_id: string }>();

  if (!call) {
    return jsonResponse(request, 404, { error: "Call not found" });
  }

  if (action === "accept") {
    if (!["initiated", "ringing"].includes(call.status) || !["invited", "ringing"].includes(participant.status)) {
      return jsonResponse(request, 409, { error: "Call is no longer available" });
    }

    const { data: updatedCall, error: updateError } = await supabase
      .from("calls")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", payload.callId)
      .in("status", ["initiated", "ringing"])
      .select("id")
      .maybeSingle<{ id: string }>();

    if (updateError || !updatedCall) {
      return jsonResponse(request, 409, { error: "Call was already answered or ended" });
    }

    await supabase
      .from("call_participants")
      .update({ status: "accepted", joined_at: new Date().toISOString() })
      .eq("id", participant.id);
    await supabase.from("call_events").insert({
      call_id: payload.callId,
      event_type: "call_accepted",
      user_id: device.user_id,
      metadata: { accepted_via: "native_device", callType: call.type, room_id: call.room_id },
    });

    return jsonResponse(request, 200, {
      accepted: true,
      callId: call.id,
      callType: call.type,
      roomId: call.room_id,
    });
  }

  const endStatus = action === "decline" ? "declined" : "cancelled";
  await supabase
    .from("call_participants")
    .update({ status: action === "decline" ? "declined" : "left", left_at: new Date().toISOString() })
    .eq("id", participant.id);
  await supabase
    .from("calls")
    .update({ status: endStatus, ended_at: new Date().toISOString() })
    .eq("id", payload.callId)
    .in("status", ["initiated", "ringing"]);
  await supabase.from("call_events").insert({
    call_id: payload.callId,
    event_type: action === "decline" ? "call_declined" : "call_ended",
    user_id: device.user_id,
    metadata: { action_via: "native_device", callType: call.type, room_id: call.room_id },
  });

  return jsonResponse(request, 200, { action, callId: call.id });
});
