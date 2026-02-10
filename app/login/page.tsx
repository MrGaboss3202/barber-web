"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [showPass, setShowPass] = useState(false);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErr(`${error.message}${error.status ? ` (status ${error.status})` : ""}`);
      setBusy(false);
      return;
    }

    // ✅ Ya hay sesión en el navegador
    router.replace("/admin");
  }

  async function sendReset() {
    setBusy(true);
    setErr(null);
    setInfo(null);

    const e = email.trim();
    if (!e) {
      setErr("Pon tu email para enviarte el link de cambio de contraseña.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(e, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      setErr(`${error.message}${error.status ? ` (status ${error.status})` : ""}`);
      setBusy(false);
      return;
    }

    setInfo("✅ Listo. Revisa tu correo para cambiar la contraseña.");
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-black">
      <form onSubmit={doLogin} className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 border border-zinc-800">
        <h1 className="text-2xl font-bold text-white mb-4">Staff Login</h1>

        {err && (
          <div className="mb-4 p-3 rounded bg-red-900/30 border border-red-800 text-red-200">
            {err}
          </div>
        )}

        {info && (
          <div className="mb-4 p-3 rounded bg-green-900/20 border border-green-800 text-green-200">
            {info}
          </div>
        )}

        <label className="block text-sm text-zinc-200 mb-1">Email</label>
        <input
          className="w-full p-3 rounded bg-white text-black mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="micorreo@gmail.com"
          autoComplete="email"
          disabled={busy}
        />

        <label className="block text-sm text-zinc-200 mb-1">Password</label>

        {/* Input + Ojito */}
        <div className="relative mb-4">
          <input
            type={showPass ? "text" : "password"}
            className="w-full p-3 pr-12 rounded bg-white text-black"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />

          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-zinc-200 hover:bg-white text-zinc-900 text-sm"
            aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
            disabled={busy}
          >
            {showPass ? "🙈" : "👁️"}
          </button>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full p-3 rounded bg-blue-600 text-white font-semibold disabled:opacity-60"
        >
          {busy ? "Entrando..." : "Entrar"}
        </button>

        <button
          type="button"
          onClick={sendReset}
          disabled={busy}
          className="w-full mt-3 p-3 rounded border border-zinc-700 bg-transparent text-zinc-200 font-semibold disabled:opacity-60"
        >
          Olvidé mi contraseña
        </button>
      </form>
    </div>
  );
}
