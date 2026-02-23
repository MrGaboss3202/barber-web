import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";

const PALETTE = {
  brown: "#82543F",
  sand: "#BD916C",
  stone: "#967D65",
  copper: "#A77045",
  beige: "#C3A084",
};

function getDisplayNameFromEmail(email?: string | null) {
  if (!email) return "Sin sesión";
  const local = email.split("@")[0].toLowerCase();

  // exactos que pediste
  if (local === "demianbello426") return "Demian";
  if (local === "gabygaviota7667") return "Gaby";
  if (local === "lubony7") return "Luis";

  // fallback por si luego agregas más usuarios
  const guessed = local
    .replace(/[0-9._-]+/g, " ")
    .trim()
    .split(" ")[0];

  if (!guessed) return email;

  return guessed.charAt(0).toUpperCase() + guessed.slice(1);
}

export default async function AdminHome() {
  const supabase = await supabaseServer();

  // 1) Intento principal: usuario autenticado (server-side)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();

  // 2) Fallback: leer sesión (útil cuando getUser no trae user por cookies/middleware)
  const { data: sessionRes } = await supabase.auth.getSession();

  const email =
    userRes?.user?.email ??
    sessionRes?.session?.user?.email ??
    null;

  const displayName = getDisplayNameFromEmail(email);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <TopNav role="admin" />

      {/* Fondo sutil con la gama */}
      <div
        className="min-h-[calc(100vh-65px)]"
        style={{
          background: `
            radial-gradient(circle at 8% 10%, rgba(130,84,63,.28), transparent 28%),
            radial-gradient(circle at 92% 18%, rgba(167,112,69,.22), transparent 26%),
            radial-gradient(circle at 35% 75%, rgba(189,145,108,.12), transparent 30%),
            #000
          `,
        }}
      >
        <div className="mx-auto max-w-7xl px-6 py-10">
          {/* Hero + módulos a la derecha */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-stretch">
            {/* HERO izquierdo */}
            <section
              className="rounded-3xl border p-8 shadow-2xl"
              style={{
                background:
                  "linear-gradient(180deg, rgba(15,15,20,.95), rgba(10,10,12,.92))",
                borderColor: "rgba(167,112,69,.35)",
                boxShadow: "0 20px 60px rgba(0,0,0,.55)",
              }}
            >
              <div
                className="inline-flex items-center gap-2 rounded-full border px-4 py-1 mb-5 text-sm font-semibold italic"
                style={{
                  color: "#D8C2B0",
                  borderColor: "rgba(167,112,69,.45)",
                  backgroundColor: "rgba(167,112,69,.10)",
                }}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#BD9E84]" />
                Panel administrativo
              </div>

              <h1 className="text-4xl md:text-5xl font-black italic tracking-tight text-white">
                Admin Dashboard
              </h1>

              <p className="mt-4 text-xl md:text-2xl font-semibold italic text-zinc-300 leading-relaxed">
                Gestiona clientes, promociones y seguimiento de tu barbería con
                una interfaz más clara y rápida.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/admin/customers"
                  className="px-6 py-3 rounded-2xl font-bold italic text-black shadow-lg transition hover:scale-[1.02]"
                  style={{
                    background:
                      "linear-gradient(135deg, #C3A084 0%, #C3A084 55%, #967D65 100%)",
                  }}
                >
                  Ir a Clientes
                </Link>

                <Link
                  href="/barber"
                  className="px-6 py-3 rounded-2xl font-bold italic border text-zinc-100 transition hover:bg-white/5"
                  style={{
                    borderColor: "rgba(195,160,132,.22)",
                    backgroundColor: "rgba(255,255,255,.03)",
                  }}
                >
                  Ir a Scanner
                </Link>
              </div>
            </section>

            {/* DERECHA: módulos uno encima del otro */}
            <section
              className="rounded-3xl border p-6"
              style={{
                background:
                  "linear-gradient(180deg, rgba(17,17,22,.92), rgba(11,11,13,.95))",
                borderColor: "rgba(195,160,132,.14)",
              }}
            >
              <div className="grid grid-cols-1 gap-5">
                <Link
                  href="/admin/customers"
                  className="rounded-3xl border p-6 transition hover:-translate-y-0.5 hover:shadow-xl"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(20,20,24,.95), rgba(14,14,18,.95))",
                    borderColor: "rgba(195,160,132,.16)",
                  }}
                >
                  <div
                    className="text-sm font-semibold italic"
                    style={{ color: "#cbd5e1" }}
                  >
                    Módulo
                  </div>
                  <div className="mt-1 text-4xl font-black italic text-white">
                    Clientes
                  </div>
                  <p className="mt-3 text-lg font-semibold italic text-zinc-400 leading-relaxed">
                    Buscar, editar, pintar filas, QR, WhatsApp y visitas.
                  </p>
                </Link>

                <Link
                  href="/barber"
                  className="rounded-3xl border p-6 transition hover:-translate-y-0.5 hover:shadow-xl"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(20,20,24,.95), rgba(14,14,18,.95))",
                    borderColor: "rgba(195,160,132,.16)",
                  }}
                >
                  <div
                    className="text-sm font-semibold italic"
                    style={{ color: "#cbd5e1" }}
                  >
                    Módulo
                  </div>
                  <div className="mt-1 text-4xl font-black italic text-white">
                    Scanner
                  </div>
                  <p className="mt-3 text-lg font-semibold italic text-zinc-400 leading-relaxed">
                    Escaneo de QR y registro rápido de visitas en mostrador.
                  </p>
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}