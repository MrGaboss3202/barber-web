// supabase/functions/register-visit/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function extractTokenPrefix(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Si viene URL tipo .../scan?t=XXX
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const u = new URL(raw);
      const t = u.searchParams.get("t");
      if (t) return t.trim();
    } catch {}
  }

  // Si viene tipo "t=XXX"
  if (raw.startsWith("t=")) return raw.slice(2).trim();

  // Si viene token directo
  return raw;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // Preflight CORS
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

  // 1) Debe venir JWT de usuario logueado (NO la publishable key)
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // Cliente "user" (anon) para validar JWT y obtener user_id
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

  // Cliente "service" para DB (bypass RLS, PERO nosotros validamos rol)
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 2) Validar rol en app.staff_users
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
  if (role !== "admin" && role !== "barber") {
    return new Response(JSON.stringify({ error: "Forbidden: not staff" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 3) Leer body
  const body = await req.json().catch(() => ({}));
  const token_prefix = extractTokenPrefix(body?.token_prefix ?? "");
  const customer_id_from_body = (body?.customer_id ?? "").trim();
  const notes = typeof body?.notes === "string" ? body.notes : null;

  // ✅ dry_run REAL (si true: NO inserta)
  const dry_run = Boolean(body?.dry_run);

  // source: "qr" o "manual"
  const requestedSource = (body?.source ?? "qr") as string;
  const source = requestedSource === "manual" ? "manual" : "qr";

  // Si quieren registrar manual, solo admin
  if (source === "manual" && role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden: manual requires admin" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // start_at opcional (para manual). Para QR usamos now()
  const start_at =
    typeof body?.start_at === "string" && body.start_at.trim()
      ? body.start_at.trim()
      : new Date().toISOString();

  if (!token_prefix && !customer_id_from_body) {
    return new Response(JSON.stringify({ error: "Provide token_prefix or customer_id" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 4) Resolver customer_id usando la vista v_customers_qr
  let customer_id: string | null = null;
  let full_name: string | null = null;

  if (customer_id_from_body) {
    customer_id = customer_id_from_body;
  } else {
    const trySchemas: Array<"app" | "public"> = ["app", "public"];
    let lastErr: string | null = null;

    for (const sch of trySchemas) {
      const { data, error } = await supabaseService
        .schema(sch)
        .from("v_customers_qr")
        .select("customer_id, full_name, token_prefix")
        .eq("token_prefix", token_prefix)
        .limit(1);

      if (error) {
        lastErr = error.message;
        continue;
      }

      const row = data?.[0];
      if (row?.customer_id) {
        customer_id = row.customer_id;
        full_name = row.full_name ?? null;
        break;
      }
    }

    if (!customer_id) {
      return new Response(JSON.stringify({ error: "Token not found", detail: lastErr }), {
        status: 404,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
  }

  // 5) Conteo actual (no inserta)
  const { count: total_before, error: cntBeforeErr } = await supabaseService
    .schema("app")
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer_id);

  // ✅ Si dry_run, NO insertamos y regresamos data
  if (dry_run) {
    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: true,
        role,
        customer: { customer_id, full_name, token_prefix },
        total_visits: cntBeforeErr ? null : total_before,
        warn: cntBeforeErr ? cntBeforeErr.message : null,
      }),
      { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
    );
  }

  // 6) Insert REAL
  const { data: inserted, error: insErr } = await supabaseService
    .schema("app")
    .from("visits")
    .insert({
      customer_id,
      staff_user_id,
      start_at,   // tu columna real
      source,     // requiere la columna source que te puse en SQL
      notes,
      // visit_kind queda default ('corte') si ya lo tienes así
    })
    .select("id, customer_id, staff_user_id, start_at, source")
    .single();

  if (insErr) {
    return new Response(JSON.stringify({ error: "Insert failed", detail: insErr.message }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 7) Conteo después
  const { count: total_after } = await supabaseService
    .schema("app")
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customer_id);

  return new Response(
    JSON.stringify({
      ok: true,
      dry_run: false,
      role,
      visit: inserted,
      customer: { customer_id, full_name, token_prefix },
      total_visits: total_after ?? null,
    }),
    { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
  );
});
