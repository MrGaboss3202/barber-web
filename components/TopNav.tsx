"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  role?: "admin" | "barber";
};

export function TopNav(_props: Props) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        background:
          "linear-gradient(90deg, rgba(130,84,63,0.16) 0%, rgba(0,0,0,0.92) 22%, rgba(0,0,0,0.94) 78%, rgba(167,112,69,0.16) 100%)",
        borderColor: "rgba(195,160,132,0.15)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center justify-between">
        {/* Marca (Águila + Logo dorado) */}
        <Link
          href="/admin"
          className="flex items-center gap-2 sm:gap-3 group min-w-0"
        >
          {/* Águila: tamaño fijo para que no cambie entre localhost / Vercel */}
          <div className="shrink-0 flex items-center">
            <Image
              src="/icons/aguila.png" // <- renombra el archivo para romper caché
              alt="Águila Mr Gaboss"
              width={150}
              height={56}
              priority
              className="h-auto w-[110px] sm:w-[130px] md:w-[150px] object-contain drop-shadow-[0_3px_10px_rgba(167,112,69,0.30)] transition-transform duration-200 group-hover:scale-[1.03]"
            />
          </div>

          {/* Logo texto dorado */}
          <div className="shrink-0 flex items-center">
            <Image
              src="/icons/gaboss.png"
              alt="Mr Gaboss Barber Shop"
              width={180}
              height={60}
              priority
              className="h-auto w-[120px] sm:w-[145px] md:w-[180px] object-contain drop-shadow-[0_3px_10px_rgba(195,160,132,0.18)] transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </div>
        </Link>

        {/* Botón salir */}
        <button
          onClick={handleLogout}
          className="px-4 py-2 rounded-xl font-semibold text-sm border transition"
          style={{
            backgroundColor: "rgba(195,160,132,0.95)",
            borderColor: "rgba(195,160,132,0.35)",
            color: "#111111",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(167,112,69,0.95)";
            e.currentTarget.style.borderColor = "rgba(167,112,69,0.55)";
            e.currentTarget.style.color = "#ffffff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(195,160,132,0.95)";
            e.currentTarget.style.borderColor = "rgba(195,160,132,0.35)";
            e.currentTarget.style.color = "#111111";
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}