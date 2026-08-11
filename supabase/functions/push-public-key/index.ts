import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";

const allowedHeaders = "authorization, x-client-info, apikey, content-type";
const allowedMethods = "GET, OPTIONS";
const defaultAllowedOrigins = [
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

function getCorsHeaders(request: Request) {
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

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  if (request.method !== "GET") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  const publicKey = Deno.env.get("PUSH_PUBLIC_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!publicKey || !supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(request, 500, { error: "Push configuration is unavailable" });
  }

  const authorization = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, 401, { error: "Authentication is required" });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonResponse(request, 401, { error: "Invalid authentication token" });
  }

  return jsonResponse(request, 200, { publicKey });
});
