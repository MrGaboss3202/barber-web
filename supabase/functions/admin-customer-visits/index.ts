import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type PromoKind = "none" | "promo50" | "birthday";

type Body = {
  customer_id?: string;
  limit?: number;
  offset?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return res({ ok: false, error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return res({ ok: false, error: "missing_authorization" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return res({ ok: false, error: "missing_env" });
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) return res({ ok: false, error: "invalid_jwt" });

  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // staff role
  const { data: staffRow, error: staffErr } = await supabaseService
    .schema("app")
    .from("staff_users")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (staffErr) return res({ ok: false, error: "staff_lookup_failed", details: staffErr.message });

  const role = staffRow?.role;
  if (role !== "admin" && role !== "barber") return res({ ok: false, error: "not_staff" });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const customer_id = body.customer_id;
  if (!isUuid(customer_id)) return res({ ok: false, error: "invalid_customer_id_uuid" });

  const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 50);
  const offset = Math.max(Number(body.offset ?? 0), 0);

  const q = supabaseService
    .schema("app")
    .from("visits")
    .select("id, customer_id, start_at, notes, staff_user_id, promo_kind, source", { count: "exact" })
    .eq("customer_id", customer_id)
    .order("start_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: rows, error, count } = await q;
  if (error) return res({ ok: false, error: "query_failed", details: error.message });

  const visits = rows ?? [];

  // Resolver emails (máximo 10-50, es seguro)
  const ids = Array.from(
    new Set(
      visits
        .map((v: any) => v.staff_user_id as string | null)
        .filter((x): x is string => !!x)
    )
  );

  const emailById = new Map<string, string>();
  for (const id of ids) {
    const { data } = await supabaseService.auth.admin.getUserById(id).catch(() => ({ data: null as any }));
    const email = data?.user?.email ?? null;
    if (email) emailById.set(id, email);
  }

  const items = visits.map((v: any) => ({
    id: v.id,
    customer_id: v.customer_id,
    start_at: v.start_at,
    notes: v.notes ?? null,
    promo_kind: (v.promo_kind ?? "none") as PromoKind, // ✅ AQUÍ YA VIENE BIEN
    added_by_email: v.source === "import" || !v.staff_user_id ? null : (emailById.get(v.staff_user_id) ?? null),
  }));

  return res({ ok: true, role, items, total: count ?? null, limit, offset });
});
