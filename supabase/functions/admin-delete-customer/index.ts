import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function isUuid(v: any) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) JWT del usuario logueado (TU UI lo manda)
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Authorization Bearer token" }), {
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
    return new Response(JSON.stringify({ ok: false, error: "Invalid session", detail: userErr?.message ?? null }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
  const staff_user_id = userData.user.id;

  // Cliente service para DB (bypass RLS)
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 2) Validar rol (RECOMENDADO: solo admin borra)
  const { data: staffRow, error: staffErr } = await supabaseService
    .schema("app")
    .from("staff_users")
    .select("role")
    .eq("user_id", staff_user_id)
    .maybeSingle();

  if (staffErr) {
    return new Response(JSON.stringify({ ok: false, error: "Failed to read staff role", detail: staffErr.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const role = staffRow?.role ?? null;
  if (role !== "admin") {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden: only admin can delete customers" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 3) body
  const body = await req.json().catch(() => ({}));
  const customer_id = body?.customer_id;

  if (!isUuid(customer_id)) {
    return new Response(JSON.stringify({ ok: false, error: "customer_id inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 4) Borrar visitas y cliente
  const { error: delVisitsErr, count: delVisitsCount } = await supabaseService
    .schema("app")
    .from("visits")
    .delete({ count: "exact" })
    .eq("customer_id", customer_id);

  if (delVisitsErr) {
    return new Response(JSON.stringify({ ok: false, error: "Failed to delete visits", detail: delVisitsErr.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { error: delCustomerErr, count: delCustomerCount } = await supabaseService
    .schema("app")
    .from("customers")
    .delete({ count: "exact" })
    .eq("id", customer_id);

  if (delCustomerErr) {
    return new Response(JSON.stringify({ ok: false, error: "Failed to delete customer", detail: delCustomerErr.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      deleted_customer: delCustomerCount ?? 0,
      deleted_visits: delVisitsCount ?? 0,
    }),
    { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
  );
});
