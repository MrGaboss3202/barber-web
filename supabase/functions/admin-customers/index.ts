import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

  // 1) JWT de usuario logueado
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

  // Cliente service para DB
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 2) Validar rol (admin o barber pueden ver)
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
  if (role !== "admin" && role !== "barber") {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden: not staff" }), {
      status: 403,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // 3) body: búsqueda + paginación + orden + filtros
  const body = await req.json().catch(() => ({}));

  const q = typeof body?.q === "string" ? body.q.trim() : "";
  const limit = Number.isFinite(body?.limit) ? Math.min(200, Math.max(1, body.limit)) : 50;
  const offset = Number.isFinite(body?.offset) ? Math.max(0, body.offset) : 0;

  // sort_by: full_name | total_visits | promo_50_ok_cycles | last_visit_at
  const sort_by_raw = typeof body?.sort_by === "string" ? body.sort_by : "full_name";
  const sort_dir_raw = typeof body?.sort_dir === "string" ? body.sort_dir : "asc";

  const sort_by =
    sort_by_raw === "total_visits" ||
    sort_by_raw === "promo_50_ok_cycles" ||
    sort_by_raw === "last_visit_at" ||
    sort_by_raw === "full_name"
      ? sort_by_raw
      : "full_name";

  const sort_dir = sort_dir_raw === "desc" ? "desc" : "asc";
  const filter_star = body?.filter_star === true;
  const filter_birthday = body?.filter_birthday === true;

  // 4) Query a la vista NUEVA v3 (trae discount_pending y birthday_eligible_today)
  let query = supabaseService
    .schema("app")
    .from("v_admin_customers_v3")
    .select("*", { count: "exact" })
    .order(sort_by, { ascending: sort_dir === "asc", nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const like = `%${q}%`;
    query = query.or(`full_name.ilike.${like},token_prefix.ilike.${like},phone_norm.ilike.${like}`);
  }

  // ⭐ Ahora se filtra por discount_pending (NO por múltiplos)
  if (filter_star) {
    query = query.eq("discount_pending", true);
  }

  // 🎂 Se filtra por birthday_eligible_today
  if (filter_birthday) {
    query = query.eq("birthday_eligible_today", true);
  }

  const { data, error, count } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: "query_failed", detail: error.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      role,
      q,
      limit,
      offset,
      total: count ?? 0,
      items: data ?? [],
    }),
    { status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } }
  );
});
