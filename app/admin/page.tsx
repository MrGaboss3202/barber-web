import { supabaseServer } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";

export default async function AdminHome() {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopNav role="admin" />
      <div className="p-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-zinc-300 mt-2">Logueado como: {userData.user?.email}</p>
      </div>
    </div>
  );
}
