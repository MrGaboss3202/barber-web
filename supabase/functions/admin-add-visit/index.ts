import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/requireUser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type PromoKind = "none" | "promo50" | "birthday";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isBirthdayEligible(supabaseAdmin: any, customer_id: string) {
  // intenta v_birthday_eligible_today, y si no existe, intenta _v2
  try {
    const { data, error } = await supabaseAdmin
      .schema("app")
      .from("v_birthday_eligible_today")
      .select("customer_id")
      .eq("customer_id", customer_id)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } catch {
    const { data } = await supabaseAdmin
      .schema("app")
      .from("v_birthday_eligible_today_v2")
      .select("customer_id")
      .eq("customer_id", customer_id)
      .maybeSingle();
    return !!data;
  }
}

async function getCreditsAvailable(supabaseAdmin: any, customer_id: string) {
  const { count: normalCount, error: e1 } = await supabaseAdmin
    .schema("app")
    .from("visits")
    .select("id", { head: true, count: "exact" })
    .eq("customer_id", customer_id)
    .eq("promo_kind", "none");

  if (e1) throw new Error(e1.message);

  const { count: usedCount, error: e2 } = await supabaseAdmin
    .schema("app")
    .from("visits")
    .select("id", { head: true, count: "exact" })
    .eq("customer_id", customer_id)
    .eq("promo_kind", "promo50");

  if (e2) throw new Error(e2.message);

  const earned = Math.floor((normalCount ?? 0) / 4);
  const credits = Math.max(0, earned - (usedCount ?? 0));
  const progress = (normalCount ?? 0) % 4;

  return {
    credits,
    progress,
    normalCount: normalCount ?? 0,
    usedCount: usedCount ?? 0,
  };
}

/**
 * ✅ Resuelve token_prefix usando la VIEW app.v_customers_token_prefix
 * (token_prefix = primeros 10 chars del UUID sin guiones)
 */
async function resolveCustomerByToken(supabaseAdmin: any, token_prefix: string) {
  const { data, error } = await supabaseAdmin
    .schema("app")
    .from("v_customers_token_prefix")
    .select("id, full_name, phone_norm, token_prefix")
    .eq("token_prefix", token_prefix)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) return null;

  return {
    customer_id: data.id as string,
    full_name: (data.full_name ?? null) as string | null,
    phone_norm: (data.phone_norm ?? null) as string | null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    // ✅ Requiere sesión válida del usuario (barbero/admin) => 401 si no
    const { user, error } = await requireUser(req);
    if (!user) return json({ ok: false, error: "unauthorized", details: error }, 401);

    const body = await req.json().catch(() => ({}));

    const dry_run = !!body.dry_run;

    const token_prefix = String(body.token_prefix ?? "").trim();
    let customer_id = String(body.customer_id ?? "").trim();

    const promo_kind = (body.promo_kind ?? "none") as PromoKind;
    const notes = body.notes ?? null;

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // =========================
    // 1) Resolver token -> customer
    // =========================
    let customer: { customer_id: string; full_name: string | null; phone_norm: string | null } | null = null;

    if (!customer_id) {
      if (!token_prefix) {
        return json({ ok: false, error: "bad_request", details: "customer_id o token_prefix requerido" }, 400);
      }

      customer = await resolveCustomerByToken(supabaseAdmin, token_prefix);

      if (!customer) {
        return json({ ok: false, error: "not_found", details: "Token no existe o cliente no encontrado" }, 404);
      }

      customer_id = customer.customer_id;
    } else {
      // si ya viene customer_id, traemos datos básicos (SIN token_prefix)
      const { data, error: ce } = await supabaseAdmin
        .schema("app")
        .from("customers")
        .select("id, full_name, phone_norm")
        .eq("id", customer_id)
        .maybeSingle();

      if (ce) throw new Error(ce.message);
      if (!data?.id) return json({ ok: false, error: "not_found", details: "Cliente no encontrado" }, 404);

      customer = {
        customer_id: data.id as string,
        full_name: (data.full_name ?? null) as string | null,
        phone_norm: (data.phone_norm ?? null) as string | null,
      };
    }

    // =========================
    // flags (⭐/🎂) siempre
    // =========================
    const { credits, progress } = await getCreditsAvailable(supabaseAdmin, customer_id);
    const bdayOk = await isBirthdayEligible(supabaseAdmin, customer_id);

    const flags = {
      discount_credits: credits,
      discount_progress: progress,
      birthday_eligible_today: bdayOk,
    };

    // ✅ Caso scanner: solo validar token / mostrar menú
    const start_at = String(body.start_at ?? "").trim();
    if (!start_at) {
      return json({ ok: true, customer, flags, resolved_only: true });
    }

    // =========================
    // 2) Validar e (insertar o dry_run)
    // =========================
    const dt = new Date(start_at);
    if (Number.isNaN(dt.getTime())) {
      return json({ ok: false, error: "bad_request", details: "start_at inválido" }, 400);
    }

    if (promo_kind === "promo50" && credits <= 0) {
      return json({ ok: false, error: "bad_request", details: "Este cliente NO tiene cupón disponible." }, 400);
    }

    if (promo_kind === "birthday" && !bdayOk) {
      return json({ ok: false, error: "bad_request", details: "Este cliente NO está en ventana de cumpleaños." }, 400);
    }

    if (dry_run) {
      return json({ ok: true, customer, flags, would_insert: true });
    }

    const { data: ins, error: insErr } = await supabaseAdmin
      .schema("app")
      .from("visits")
      .insert({
        customer_id,
        staff_user_id: user.id,
        start_at: dt.toISOString(),
        visit_kind: "corte",
        source: "manual",
        promo_kind,
        notes,
      })
      .select("id, customer_id, staff_user_id, start_at, visit_kind, source, notes, promo_kind")
      .single();

    if (insErr) return json({ ok: false, error: "db_error", details: insErr.message }, 500);

    // si existe recompute, se llama (si falla no rompe)
    const { error: rpcErr } = await supabaseAdmin
      .schema("app")
      .rpc("recompute_discount_state", { p_customer_id: customer_id });

    if (rpcErr) console.warn("recompute_discount_state error:", rpcErr.message);

    return json({ ok: true, item: ins, customer, flags });
  } catch (e) {
    return json(
      { ok: false, error: "server_error", details: String((e as any)?.message ?? e) },
      500
    );
  }
});
