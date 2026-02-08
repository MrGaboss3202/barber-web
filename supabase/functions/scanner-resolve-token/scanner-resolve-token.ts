import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeToken(raw: string) {
  return (raw ?? "").trim();
}

function isValidToken(t: string) {
  // token_prefix actual: 10 chars alfanum
  return /^[a-z0-9]{10}$/i.test(t);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // ✅ (opcional pero recomendado) exigir sesión válida
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData } = await supabaseAuth.auth.getUser();
  if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const token = normalizeToken(body?.token ?? "");

  if (!isValidToken(token)) {
    return json({ ok: false, error: "Token inválido" }, 400);
  }

  // ✅ Service role para leer el view sin pelear con RLS
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabaseAdmin
    .from("v_admin_customers_v3")
    .select("customer_id, full_name, phone_norm")
    .eq("token_prefix", token)
    .maybeSingle();

  if (error) return json({ ok: false, error: "DB error", details: error.message }, 500);
  if (!data) return json({ ok: false, error: "Cliente no encontrado" }, 404);

  return json({ ok: true, customer: data });
});
