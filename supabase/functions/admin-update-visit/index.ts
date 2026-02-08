import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/requireUser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const { user, error } = await requireUser(req);
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized", details: error }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const visit_id = String(body.visit_id ?? "");
    const start_at = String(body.start_at ?? "");
    const notes = body.notes ?? null;

    if (!visit_id) throw new Error("visit_id requerido");
    if (!start_at) throw new Error("start_at requerido");

    const iso = new Date(start_at);
    if (Number.isNaN(iso.getTime())) throw new Error("start_at inválido (ISO)");

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data, error: upErr } = await supabaseAdmin
      .schema("app")
      .from("visits")
      .update({
        start_at: iso.toISOString(),
        notes,
        // opcional: guardar quién editó, si tu tabla lo tiene
        // updated_by_email: user.email ?? null,
      })
      .eq("id", visit_id)
      .select("id, customer_id, start_at, notes, added_by_email, promo_kind")
      .single();

    if (upErr) throw new Error(`update visits: ${upErr.message}`);

    // Recalcular si quieres (necesita customer_id)
    const customer_id = data?.customer_id;
    if (customer_id) {
      const { error: rpcErr } = await supabaseAdmin
        .schema("app")
        .rpc("recompute_discount_state", { p_customer_id: customer_id });
      if (rpcErr) console.warn("recompute_discount_state error:", rpcErr.message);
    }

    return new Response(JSON.stringify({ ok: true, item: data }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "bad_request", details: String(e?.message ?? e) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
