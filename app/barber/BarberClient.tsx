"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PromoKind = "none" | "promo50" | "birthday";

function extractTokenPrefix(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const u = new URL(s);
      const t = u.searchParams.get("t");
      if (t) return t.trim();
    } catch {}
  }

  if (s.startsWith("t=")) return s.slice(2).trim();
  return s;
}

function nowLocalInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export default function BarberClient() {
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState<string>("Cámara detenida.");

  // Modal / Menú
  const [menuOpen, setMenuOpen] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const [token, setToken] = useState<string>("");
  const [customer, setCustomer] = useState<{
    customer_id: string;
    full_name: string | null;
    phone_norm: string | null;
  } | null>(null);

  const [flags, setFlags] = useState<{
    discount_credits: number;
    discount_progress?: number;
    birthday_eligible_today: boolean;
  } | null>(null);

  const [startAtLocal, setStartAtLocal] = useState(nowLocalInput());
  const [promoKind, setPromoKind] = useState<PromoKind>("none");
  const [notes, setNotes] = useState("");

  const scannerRef = useRef<any>(null);
  const startedRef = useRef(false);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Tu función real suele ser admin-add-visit (pero dejo fallback por si acaso)
  const FUNCTION_CANDIDATES = ["admin-add-visit", "add-visit"];

  async function getAccessTokenOrThrow() {
    const supabase = supabaseBrowser();

    const { data: s1 } = await supabase.auth.getSession();
    let token = s1.session?.access_token ?? null;

    if (!token) {
      const { data: s2, error: e2 } = await supabase.auth.refreshSession();
      if (e2 || !s2.session?.access_token) {
        throw new Error("No hay sesión. Cierra sesión y vuelve a iniciar.");
      }
      token = s2.session.access_token;
    }

    return token;
  }

  async function callAddVisit(payload: any) {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel/.env");
    }

    const supabase = supabaseBrowser();
    let accessToken = await getAccessTokenOrThrow();

    const doFetch = async (fnName: string, tokenToUse: string) => {
      const url = `${SUPABASE_URL}/functions/v1/${fnName}`;
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${tokenToUse}`,
        },
        body: JSON.stringify(payload),
      });
    };

    for (const fnName of FUNCTION_CANDIDATES) {
      let res = await doFetch(fnName, accessToken);

      // si JWT expiró, refresh y reintenta 1 vez
      if (res.status === 401) {
        const { data: s2 } = await supabase.auth.refreshSession();
        if (s2.session?.access_token) {
          accessToken = s2.session.access_token;
          res = await doFetch(fnName, accessToken);
        }
      }

      if (res.status === 404) continue;

      const json = await safeJson(res);
      if (!res.ok) {
        const details = json?.details ? ` (${json.details})` : "";
        throw new Error(`Error ${res.status}: ${json?.error ?? "Edge Function error"}${details}`);
      }
      return json;
    }

    throw new Error(`No encuentro la Edge Function. Probé: ${FUNCTION_CANDIDATES.join(", ")}`);
  }

  async function resolveToken(tokenOrUrl: string) {
    const token_prefix = extractTokenPrefix(tokenOrUrl);
    if (!token_prefix) {
      setStatus("Token vacío.");
      return;
    }

    setBusy(true);
    setStatus("Validando token...");
    setCustomer(null);
    setFlags(null);
    setToken("");

    try {
      const json = await callAddVisit({ token_prefix, dry_run: true });
      if (!json?.ok) return;

      setToken(token_prefix);
      setCustomer(json.customer ?? null);
      setFlags(json.flags ?? null);

      setStartAtLocal(nowLocalInput());
      setPromoKind("none");
      setNotes("");

      setMenuOpen(true);
      setStatus("Token OK. Selecciona tipo/nota y registra.");
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitVisit() {
    if (!customer?.customer_id) {
      setStatus("Primero escanea un token.");
      return;
    }

    const credits = flags?.discount_credits ?? 0;
    const bdayOk = !!flags?.birthday_eligible_today;

    if (promoKind === "promo50" && credits <= 0) {
      setStatus("Este cliente NO tiene cupón ⭐ disponible.");
      return;
    }
    if (promoKind === "birthday" && !bdayOk) {
      setStatus("Este cliente NO está en ventana 🎂 (o ya lo canjeó).");
      return;
    }

    setBusy(true);
    setStatus(dryRun ? "Validando (SIN registrar)..." : "Registrando visita...");

    try {
      const iso = new Date(startAtLocal).toISOString();

      const json = await callAddVisit({
        customer_id: customer.customer_id,
        start_at: iso,
        promo_kind: promoKind,
        notes: notes?.trim()?.length ? notes.trim() : null,
        dry_run: dryRun,
      });

      if (!json?.ok) return;

      if (dryRun) {
        setStatus("✅ Validación OK (no insertó).");
        return;
      }

      setStatus("✅ Visita registrada.");
      setMenuOpen(false);

      // listo para el siguiente
      setCustomer(null);
      setFlags(null);
      setToken("");
      setNotes("");
      setPromoKind("none");
      setStartAtLocal(nowLocalInput());
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    if (startedRef.current || busy) return;
    startedRef.current = true;

    setBusy(true);
    setStatus("Iniciando cámara...");

    try {
      const mod = await import("html5-qrcode");
      const { Html5Qrcode } = mod as any;

      const html5QrCode = new Html5Qrcode("qr-reader");
      scannerRef.current = html5QrCode;

      // ✅ FIX #1 (Android): elegir un cameraId REAL (evita preview negro)
      let cameraConfig: any = { facingMode: "environment" };
      try {
        const cams = await Html5Qrcode.getCameras();
        if (Array.isArray(cams) && cams.length > 0) {
          const back =
            cams.find((c: any) => /back|rear|environment/i.test(c.label || "")) ??
            cams[cams.length - 1];
          cameraConfig = back.id;
        }
      } catch {}

      const config = {
        fps: 12,
        qrbox: (vw: number, vh: number) => {
          const minEdge = Math.min(vw, vh);
          const size = Math.floor(Math.min(320, minEdge * 0.75));
          return { width: size, height: size };
        },
        aspectRatio: 1,
        disableFlip: true,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      };

      await html5QrCode.start(
        cameraConfig,
        config,
        async (decodedText: string) => {
          // Detener y limpiar para evitar doble scan
          try {
            await html5QrCode.stop();
          } catch {}
          try {
            await html5QrCode.clear();
          } catch {}

          scannerRef.current = null;
          startedRef.current = false;
          setCameraOn(false);

          // ✅ al escanear: abre menú (NO inserta)
          await resolveToken(decodedText);
        },
        () => {}
      );

      setCameraOn(true);
      setStatus("Cámara lista. Escanea el QR.");
    } catch (e: any) {
      startedRef.current = false;
      setCameraOn(false);
      setStatus("Error al iniciar cámara: " + (e?.message ?? String(e)));
      try {
        await scannerRef.current?.stop?.();
        await scannerRef.current?.clear?.();
      } catch {}
      scannerRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function stopCamera() {
    if (busy) return;

    setBusy(true);
    try {
      const inst = scannerRef.current;
      if (inst) {
        try {
          await inst.stop();
        } catch {}
        try {
          await inst.clear();
        } catch {}
      }
    } finally {
      scannerRef.current = null;
      startedRef.current = false;
      setCameraOn(false);
      setStatus("Cámara detenida.");
      setBusy(false);
    }
  }

  async function toggleCamera() {
    if (cameraOn) await stopCamera();
    else await startCamera();
  }

  useEffect(() => {
    return () => {
      stopCamera().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const credits = flags?.discount_credits ?? 0;
  const bdayOk = !!flags?.birthday_eligible_today;

  return (
    <div className="px-6 pb-10 bg-white text-black min-h-[calc(100vh-80px)]">
      {/* Botón cámara */}
      <div className="mt-6 flex flex-col items-start gap-3">
        {/* ✅ FIX #2: color cambia verde ↔ rojo */}
        <button
          onClick={toggleCamera}
          disabled={busy}
          className={[
            "w-44 h-44 rounded-2xl shadow flex items-center justify-center disabled:opacity-60",
            cameraOn ? "bg-red-500 hover:bg-red-400" : "bg-green-600 hover:bg-green-500",
          ].join(" ")}
          title={cameraOn ? "Detener cámara" : "Iniciar cámara"}
        >
          <img src="/icons/camera.png" alt="Cámara" className="w-20 h-20" draggable={false} />
        </button>

        <div className="text-sm text-zinc-700">{status}</div>
      </div>

      {/* Preview (mantenlo renderizado aunque esté hidden) */}
      <div className={cameraOn ? "mt-4" : "mt-4 hidden"}>
        <div
          id="qr-reader"
          className="qr-wrap rounded-2xl border border-zinc-200 bg-black overflow-hidden"
          style={{ width: "100%", maxWidth: 560, height: 420 }}
        />
      </div>

      {/* Modal menú */}
      {menuOpen && customer && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">Registrar visita</h3>
                <div className="text-sm text-zinc-600">
                  {customer.full_name ?? "Cliente"} · {customer.phone_norm ?? "-"}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Token: <span className="font-mono">{token}</span>
                </div>
              </div>

              <button
                className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200"
                onClick={() => setMenuOpen(false)}
                disabled={busy}
              >
                ✕
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-700 mb-3">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={busy} />
              Modo prueba (NO registra)
            </label>

            <label className="block text-sm text-zinc-700 mb-1">Fecha/hora</label>
            <input
              type="datetime-local"
              step={1}
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={startAtLocal}
              onChange={(e) => setStartAtLocal(e.target.value)}
              disabled={busy}
            />

            <label className="block text-sm text-zinc-700 mb-1">
              Tipo (⭐ {credits} · 🎂 {bdayOk ? "sí" : "no"})
            </label>
            <select
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={promoKind}
              onChange={(e) => setPromoKind(e.target.value as PromoKind)}
              disabled={busy}
            >
              <option value="none">Normal</option>
              <option value="promo50">Promo ⭐</option>
              <option value="birthday">Cumpleaños 🎂</option>
            </select>

            {promoKind === "promo50" && credits <= 0 && (
              <div className="text-red-600 text-sm mb-2">No tiene cupón ⭐ disponible.</div>
            )}
            {promoKind === "birthday" && !bdayOk && (
              <div className="text-red-600 text-sm mb-2">No está en ventana 🎂 (o ya lo canjeó).</div>
            )}

            <label className="block text-sm text-zinc-700 mb-1">Notas</label>
            <input
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-4"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: corte + barba"
              disabled={busy}
            />

            <div className="flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                onClick={() => setMenuOpen(false)}
                disabled={busy}
              >
                Cancelar
              </button>

              <button
                className="px-4 py-2 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-60"
                onClick={submitVisit}
                disabled={
                  busy ||
                  (promoKind === "promo50" && credits <= 0) ||
                  (promoKind === "birthday" && !bdayOk)
                }
              >
                {dryRun ? "Validar" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
