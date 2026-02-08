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

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErr(`${error.message}${error.status ? ` (status ${error.status})` : ""}`);
      setBusy(false);
      return;
    }

    // si llegó aquí, ya hay sesión guardada en el navegador
    router.replace("/admin/customers");
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

        <label className="block text-sm text-zinc-200 mb-1">Email</label>
        <input
          className="w-full p-3 rounded bg-white text-black mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="eric@mr-gaboss.invalid"
          autoComplete="email"
        />

        <label className="block text-sm text-zinc-200 mb-1">Password</label>
        <input
          type="password"
          className="w-full p-3 rounded bg-white text-black mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full p-3 rounded bg-blue-600 text-white font-semibold disabled:opacity-60"
        >
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
