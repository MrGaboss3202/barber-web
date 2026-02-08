"use client";

import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopNav({ role }: { role: "admin" | "barber" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    try {
      setLoading(true);
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signOut();
      if (error) {
        // no bloquea, solo lo mostramos en consola
        console.error("logout error:", error.message);
      }
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900 text-zinc-100">
      <div className="flex gap-4 items-center">
        <Link href={role === "admin" ? "/admin" : "/barber"} className="font-bold">
          Barber System
        </Link>

        {role === "admin" && (
          <>
            <Link href="/admin/customers">Clientes</Link>
          </>
        )}

        <Link href="/barber">Scanner</Link>
      </div>

      <button
        onClick={logout}
        disabled={loading}
        className="px-3 py-2 rounded bg-zinc-200 hover:bg-white disabled:opacity-60 text-zinc-900"
      >
        {loading ? "Saliendo..." : "Cerrar sesión"}
      </button>
    </div>
  );
}
