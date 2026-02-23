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
        <Link href="/admin" className="flex items-center gap-2 sm:gap-3 group min-w-0">
          {/* Águila (ajustada para verse del tamaño visual del logo) */}
          <div className="relative h-10 w-28 sm:h-12 sm:w-36 md:h-14 md:w-44 shrink-0 overflow-visible">
            <Image
              src="/icons/aguila.png"
              alt="Águila Mr Gaboss"
              fill
              priority
              sizes="(max-width: 640px) 112px, (max-width: 768px) 144px, 176px"
              className="
                object-contain object-center
                scale-[2.85] sm:scale-[2.9] md:scale-[2.95]
                -translate-y-[1px]
                drop-shadow-[0_3px_10px_rgba(167,112,69,0.30)]
                transition-transform duration-200
                group-hover:scale-[1.6] sm:group-hover:scale-[1.65] md:group-hover:scale-[1.7]
              "
            />
          </div>

          {/* Logo texto dorado */}
          <div className="relative h-10 w-28 sm:h-12 sm:w-36 md:h-14 md:w-44 shrink-0 overflow-hidden">
            <Image
              src="/icons/gaboss.png" // <-- CAMBIA por el nombre real del archivo
              alt="Mr Gaboss Barber Shop"
              fill
              priority
              sizes="(max-width: 640px) 112px, (max-width: 768px) 144px, 176px"
              className="
                object-contain object-center
                scale-[1.08] sm:scale-[1.12] md:scale-[1.15]
                drop-shadow-[0_3px_10px_rgba(195,160,132,0.18)]
                transition-transform duration-200
                group-hover:scale-[1.12] sm:group-hover:scale-[1.16] md:group-hover:scale-[1.2]
              "
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