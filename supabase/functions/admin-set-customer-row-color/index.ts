import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json(origin, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(origin, 500, {
        ok: false,
        error: "Missing Supabase env vars",
      });
    }

    // 1) JWT usuario logueado
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json(origin, 401, { ok: false, error: "Missing Authorization Bearer token" });
    }

    // Cliente user para validar sesión del usuario
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();

    if (userErr || !userData?.user) {
      return json(origin, 401, {
        ok: false,
        error: "Invalid session",
        detail: userErr?.message ?? null,
      });
    }

    const staff_user_id = userData.user.id;

    // Cliente service para DB (sin sesión)
    const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2) Validar rol
    const { data: staffRow, error: staffErr } = await supabaseService
      .schema("app")
      .from("staff_users")
      .select("role")
      .eq("user_id", staff_user_id)
      .maybeSingle();

    if (staffErr) {
      return json(origin, 500, {
        ok: false,
        error: "Failed to read staff role",
        detail: staffErr.message,
      });
    }

    const role = staffRow?.role ?? null;
    if (role !== "admin" && role !== "barber") {
      return json(origin, 403, { ok: false, error: "Forbidden: not staff" });
    }

    // 3) Body
    const body = await req.json().catch(() => ({}));
    const customer_id = String(body?.customer_id ?? "").trim();
    const row_color = String(body?.row_color ?? "").trim().toLowerCase();

    if (!customer_id) {
      return json(origin, 400, { ok: false, error: "customer_id requerido" });
    }

    if (!/^#[0-9a-f]{6}$/.test(row_color)) {
      return json(origin, 400, {
        ok: false,
        error: "row_color inválido (usa formato #RRGGBB)",
      });
    }

    // 4) Update en app.customers
    const { data: updated, error: updErr } = await supabaseService
      .schema("app")
      .from("customers")
      .update({ row_color })
      .eq("id", customer_id) // ✅ correcto si el PK de customers es "id"
      .select("id, row_color")
      .maybeSingle();

    if (updErr) {
      return json(origin, 500, {
        ok: false,
        error: "update_failed",
        detail: updErr.message,
      });
    }

    if (!updated) {
      return json(origin, 404, {
        ok: false,
        error: "customer_not_found",
      });
    }

    return json(origin, 200, {
      ok: true,
      role,
      customer_id,
      row_color,
      updated,
    });
  } catch (e: any) {
    return json(origin, 500, {
      ok: false,
      error: "unexpected_error",
      detail: e?.message ?? String(e),
    });
  }
});