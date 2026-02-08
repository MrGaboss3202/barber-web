import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/requireUser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders: Record<string, string> = {
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

Deno.serve(async (req) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // ✅ Solo POST
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed", details: "Use POST" });
  }

  try {
    const { user, error } = await requireUser(req);
    if (!user) {
      return json(401, { ok: false, error: "unauthorized", details: error });
    }

    const body = await req.json().catch(() => ({} as any));
    const visit_id = String(body.visit_id ?? "").trim();
    const customer_id = String(body.customer_id ?? "").trim();

    if (!visit_id) return json(400, { ok: false, error: "bad_request", details: "visit_id requerido" });
    if (!customer_id) return json(400, { ok: false, error: "bad_request", details: "customer_id requerido" });

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ✅ Borra SOLO si coincide id + customer_id (evita borrar otra visita)
    const { data: deleted, error: delErr } = await supabaseAdmin
      .schema("app")
      .from("visits")
      .delete()
      .eq("id", visit_id)
      .eq("customer_id", customer_id)
      .select("id")
      .maybeSingle();

    if (delErr) {
      // Si cae aquí, sí es error real de DB/permiso/etc.
      throw new Error(`delete visits: ${delErr.message}`);
    }

    if (!deleted?.id) {
      // No encontró esa visita para ese cliente
      return json(404, {
        ok: false,
        error: "not_found",
        details: "No existe esa visita para ese cliente (o ya fue eliminada).",
      });
    }

    // ✅ Recalcular estado de descuentos (si falla, mejor avisar)
    const { error: rpcErr } = await supabaseAdmin
      .schema("app")
      .rpc("recompute_discount_state", { p_customer_id: customer_id });

    if (rpcErr) {
      // Puedes decidir si esto debe ser 200 con warning o 500.
      // Yo lo dejo como warning pero NO oculto el mensaje.
      return json(200, { ok: true, warning: `recompute_discount_state: ${rpcErr.message}` });
    }

    return json(200, { ok: true });
  } catch (e) {
    return json(400, { ok: false, error: "bad_request", details: String((e as any)?.message ?? e) });
  }
});
