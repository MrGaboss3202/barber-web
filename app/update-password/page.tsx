"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function safeGetHashParams() {
  // Supabase a veces manda tokens en el hash (#...) en recovery links
  // Ej: #access_token=...&refresh_token=...&type=recovery
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (!hash || hash.length < 2) return new URLSearchParams();
  return new URLSearchParams(hash.slice(1));
}

export default function UpdatePasswordPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [modeOk, setModeOk] = useState(false);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setMsg(null);

      // 1) Intentar leer sesión normal (por si ya existe)
      const { data: s1 } = await supabase.auth.getSession();
      if (s1.session) {
        setModeOk(true);
        setReady(true);
        return;
      }

      // 2) Si viene desde email de recovery, normalmente trae access_token/refresh_token en el hash
      const params = await safeGetHashParams();
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const type = params.get("type");

      if (type !== "recovery") {
        setMsg("Este link no es de recuperación (type != recovery). Vuelve a pedir el correo de reset.");
        setModeOk(false);
        setReady(true);
        return;
      }

      if (!access_token || !refresh_token) {
        setMsg("No llegaron tokens en el link. Vuelve a pedir el correo de reset.");
        setModeOk(false);
        setReady(true);
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (error) {
        setMsg("No se pudo abrir sesión con el link: " + error.message);
        setModeOk(false);
        setReady(true);
        return;
      }

      // limpiar el hash para que no quede el token en la barra
      window.history.replaceState({}, document.title, window.location.pathname);

      setModeOk(true);
      setReady(true);
    })();
  }, [supabase]);

  async function submit() {
    setMsg(null);

    if (password.length < 6) {
      setMsg("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMsg("Error al cambiar contraseña: " + error.message);
        return;
      }

      setMsg("✅ Contraseña actualizada. Redirigiendo...");
      // puedes cambiar a / si tu lobby está en /
      setTimeout(() => router.replace("/"), 800);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow">
        <h1 className="text-2xl font-bold mb-2">Cambiar contraseña</h1>
        <p className="text-sm text-zinc-600 mb-4">
          Abre esta página desde el link del correo de recuperación.
        </p>

        {!ready && <p className="text-sm text-zinc-600">Cargando...</p>}

        {ready && !modeOk && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
            {msg ?? "No se pudo validar el link."}
          </div>
        )}

        {ready && modeOk && (
          <>
            {msg && (
              <div className="mb-3 p-3 rounded-lg border border-zinc-200 bg-zinc-50 text-sm">
                {msg}
              </div>
            )}

            <label className="block text-sm font-medium mb-1">Nueva contraseña</label>
            <input
              type="password"
              className="w-full p-3 rounded-lg border border-zinc-300 mb-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={busy}
            />

            <label className="block text-sm font-medium mb-1">Confirmar contraseña</label>
            <input
              type="password"
              className="w-full p-3 rounded-lg border border-zinc-300 mb-4"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={busy}
            />

            <button
              onClick={submit}
              disabled={busy}
              className="w-full p-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-60"
            >
              {busy ? "Guardando..." : "Actualizar contraseña"}
            </button>

            <button
              onClick={() => router.replace("/login")}
              disabled={busy}
              className="w-full mt-3 p-3 rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-900 font-semibold disabled:opacity-60"
            >
              Volver a iniciar sesión
            </button>
          </>
        )}
      </div>
    </div>
  );
}
