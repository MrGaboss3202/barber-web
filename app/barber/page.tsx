import { supabaseServer } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import BarberClient from "./BarberClient";

export default async function BarberPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <TopNav role="barber" />
      <div className="px-6 pt-6">
        <h1 className="text-2xl font-bold">Scanner</h1>
        <p className="text-zinc-600 mt-1">Logueado como: {data.user?.email}</p>
      </div>
      <BarberClient />
    </div>
  );
}
