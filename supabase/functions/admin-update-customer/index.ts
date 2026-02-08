import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) JWT real
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // Cliente user para validar sesión
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session", detail: userErr?.message ?? null }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
  const staff_user_id = userData.user.id;

  // Cliente service para DB
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 2) Solo ADMIN puede editar
  const { data: staffRow, error: staffErr } = await supabaseService
    .schema("app")
    .from("staff_users")
    .select("role")
    .eq("user_id", staff_user_id)
    .maybeSingle();

  if (staffErr) {
    return new Response(JSON.stringify({ error: "Failed to read staff role", detail: staffErr.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const role = staffRow?.role ?? null;
  if (role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 3) Body
  const body = await req.json().catch(() => ({}));

  const customer_id =
    typeof body?.customer_id === "string" ? body.customer_id.trim() : "";

  const full_name =
    typeof body?.full_name === "string" ? body.full_name.trim() : undefined;

  const phone_norm_raw =
    typeof body?.phone_norm === "string" ? body.phone_norm : undefined;

  const birthdate_raw =
    typeof body?.birthdate === "string" ? body.birthdate.trim() : undefined;

  if (!customer_id) {
    return new Response(JSON.stringify({ error: "customer_id is required" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 4) Normaliza + valida
  const update: Record<string, any> = {};

  if (full_name !== undefined) {
    update.full_name = full_name.length ? full_name : null;
  }

  if (phone_norm_raw !== undefined) {
    const phone = onlyDigits(phone_norm_raw);
    if (phone.length > 0 && phone.length !== 10) {
      return new Response(JSON.stringify({ error: "phone_norm must be 10 digits (MX) or empty" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
    update.phone_norm = phone.length ? phone : null;
  }

  if (birthdate_raw !== undefined) {
    if (!birthdate_raw) {
      update.birthdate = null;
    } else {
      // Debe ser YYYY-MM-DD
      if (!isISODate(birthdate_raw)) {
        return new Response(JSON.stringify({ error: "birthdate must be YYYY-MM-DD or empty" }), {
          status: 400,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      }
      update.birthdate = birthdate_raw; // Postgres date lo acepta
    }
  }

  if (Object.keys(update).length === 0) {
    return new Response(JSON.stringify({ error: "Nothing to update" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 5) Update
  const { data: updated, error: updErr } = await supabaseService
    .schema("app")
    .from("customers")
    .update(update)
    .eq("id", customer_id)
    .select("id, full_name, phone_norm, birthdate")
    .maybeSingle();

  if (updErr) {
    return new Response(JSON.stringify({ error: "Update failed", detail: updErr.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  if (!updated) {
    return new Response(JSON.stringify({ error: "Customer not found" }), {
      status: 404,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, role, customer: updated }),
    { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
  );
});
