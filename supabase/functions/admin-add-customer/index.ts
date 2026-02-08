import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/requireUser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeBirthdate(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY (por si lo escriben así)
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

Deno.serve(async (req) => {
  // ✅ Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const { user, error } = await requireUser(req);
    if (!user) {
      return json(401, { ok: false, error: "unauthorized", details: error });
    }

    const body = await req.json().catch(() => ({}));

    const full_name = String(body.full_name ?? "").trim();
    const phone_norm_raw = body.phone_norm ?? null;
    const birthdate_raw = body.birthdate ?? null;

    if (!full_name) throw new Error("full_name requerido");

    const phone_norm =
      phone_norm_raw === null || phone_norm_raw === undefined || String(phone_norm_raw).trim() === ""
        ? null
        : String(phone_norm_raw).replace(/\D/g, "");

    if (phone_norm !== null && phone_norm.length !== 10) {
      throw new Error("phone_norm inválido: debe tener 10 dígitos o null");
    }

    const birthdate =
      birthdate_raw === null || birthdate_raw === undefined || String(birthdate_raw).trim() === ""
        ? null
        : normalizeBirthdate(String(birthdate_raw));

    if (birthdate_raw && birthdate === null) {
      throw new Error("birthdate inválido: usa YYYY-MM-DD (o DD/MM/YYYY)");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error: insErr } = await supabaseAdmin
      .schema("app")
      .from("customers")
      .insert({
        full_name,
        phone_norm,
        birthdate,
        status: "active",
      })
      .select("id")
      .single();

    if (insErr) throw new Error(`insert customers: ${insErr.message}`);

    // Opcional: si existe tu RPC
    const { error: rpcErr } = await supabaseAdmin
      .schema("app")
      .rpc("recompute_discount_state", { p_customer_id: data.id });

    if (rpcErr) console.warn("recompute_discount_state error:", rpcErr.message);

    return json(200, { ok: true, customer_id: data.id });
  } catch (e: any) {
    return json(400, { ok: false, error: "bad_request", details: String(e?.message ?? e) });
  }
});
