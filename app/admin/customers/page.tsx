"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PromoKind = "none" | "promo50" | "birthday";

type Item = {
  customer_id: string;
  full_name: string | null;
  phone_norm: string | null;
  birthdate: string | null;
  token_prefix: string | null;

  promo_50_ok_cycles: number | null; // promos canjeadas (redeem)
  total_visits: number | null; // total que muestra tu UI
  last_visit_at: string | null;

  // ✅ NUEVO (del backend / view)
  discount_pending?: boolean | null; // por si lo sigues trayendo
  discount_credits?: number | null; // cupones disponibles (acumulables)
  discount_progress?: number | null; // 0..3 (opcional)

  birthday_eligible_today?: boolean | null; // 🎂 ventana activa
};

type Visit = {
  id: string;
  customer_id: string;
  start_at: string;
  notes: string | null;
  added_by_email: string | null;
  promo_kind?: PromoKind | null;
};

type SortKey =
  | "name_asc"
  | "name_desc"
  | "visits_desc"
  | "visits_asc"
  | "promos_desc"
  | "promos_asc"
  | "last_desc"
  | "last_asc";

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

function safeDateOnly(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// ✅ incluye segundos (para evitar duplicados por minuto)
function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ✅ incluye segundos (para evitar duplicados si agregas rápido)
function nowLocalInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * ⭐ Criterio nuevo:
 * - Preferimos discount_credits (acumulable)
 * - Si no viene, fallback:
 *   - estA = floor(total_visits/4) - promos
 *   - estB = floor(max(0,total_visits - promos)/4) - promos
 *   - usamos el MAX para no quedarnos cortos según cómo cuente tu view total_visits
 */
function getStarCredits(it: Item): number {
  if (typeof it.discount_credits === "number") return Math.max(0, it.discount_credits);

  if (it.discount_pending) return 1;

  const tv = it.total_visits ?? 0;
  const used = it.promo_50_ok_cycles ?? 0;

  const estA = Math.floor(tv / 4) - used;
  const estB = Math.floor(Math.max(0, tv - used) / 4) - used;

  return Math.max(0, estA, estB);
}

export default function AdminCustomersPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [qInput, setQInput] = useState("");
  const [qApplied, setQApplied] = useState("");

  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("name_asc");
  const [onlyStar, setOnlyStar] = useState(false);
  const [onlyCake, setOnlyCake] = useState(false);

  function getSortParams(key: SortKey) {
    switch (key) {
      case "visits_desc":
        return { sort_by: "total_visits", sort_dir: "desc" as const };
      case "visits_asc":
        return { sort_by: "total_visits", sort_dir: "asc" as const };
      case "promos_desc":
        return { sort_by: "promo_50_ok_cycles", sort_dir: "desc" as const };
      case "promos_asc":
        return { sort_by: "promo_50_ok_cycles", sort_dir: "asc" as const };

      case "last_desc":
        return { sort_by: "last_visit_at", sort_dir: "desc" as const };

      case "last_asc": // ✅ NUEVO
        return { sort_by: "last_visit_at", sort_dir: "asc" as const };

      case "name_desc":
        return { sort_by: "full_name", sort_dir: "desc" as const };
      case "name_asc":
      default:
        return { sort_by: "full_name", sort_dir: "asc" as const };
    }
  }

  function jwtExpMs(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  function normalizeFnError(fn: string, error: any) {
    const ctx = error?.context;
    const status = ctx?.status ?? error?.status ?? "";
    const body = ctx?.body;

    const bodyText =
      typeof body === "string"
        ? body
        : body
        ? JSON.stringify(body)
        : error?.message
        ? String(error.message)
        : String(error);

    return new Error(`Edge Function ${fn} ${status}: ${bodyText}`);
  }

  async function invokeAuth<T = any>(fn: string, body: any) {
    const ensureFreshSession = async () => {
      const { data: s1 } = await supabase.auth.getSession();
      const t1 = s1.session?.access_token ?? null;

      if (!t1) {
        const { data: s2, error: e2 } = await supabase.auth.refreshSession();
        if (e2 || !s2.session?.access_token) {
          throw new Error("Sesión inválida/expirada. Cierra y vuelve a iniciar sesión.");
        }
        return;
      }

      // si expira en < 60s, refresca
      const exp = jwtExpMs(t1);
      if (exp && exp < Date.now() + 60_000) {
        const { error: e2 } = await supabase.auth.refreshSession();
        if (e2) throw new Error("No pude refrescar sesión. Cierra y vuelve a iniciar sesión.");
      }
    };

    const call = async () => {
      // supabase.functions.invoke agrega Authorization correctamente (JWT del usuario)
      const { data, error } = await supabase.functions.invoke(fn, {
        body: body ?? {},
      });

      if (error) throw normalizeFnError(fn, error);

      if (data && (data as any).ok === false) {
        const d: any = data;
        throw new Error(d?.details ? `${d.error}: ${d.details}` : d?.error ?? "ok:false");
      }

      return (data as T) ?? ({} as T);
    };

    await ensureFreshSession();

    try {
      return await call();
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      // retry si hubo 401 / Invalid JWT
      if (msg.includes("401") || msg.toLowerCase().includes("invalid jwt")) {
        const { error: e2 } = await supabase.auth.refreshSession();
        if (e2) throw e;
        return await call();
      }

      throw e;
    }
  }

  async function loadCustomers(opts?: {
    offset?: number;
    q?: string;
    sort?: SortKey;
    star?: boolean;
    cake?: boolean;
  }): Promise<{ items: Item[]; total: number } | null> {
    setBusy(true);
    setErr(null);

    try {
      const o = typeof opts?.offset === "number" ? opts.offset : offset;
      const q = typeof opts?.q === "string" ? opts.q : qApplied;
      const s = typeof opts?.sort === "string" ? opts.sort : sortKey;
      const star = typeof opts?.star === "boolean" ? opts.star : onlyStar;
      const cake = typeof opts?.cake === "boolean" ? opts.cake : onlyCake;

      const { sort_by, sort_dir } = getSortParams(s);

      const data = await invokeAuth<{ ok: true; items: Item[]; total: number }>("admin-customers", {
        q,
        limit,
        offset: o,
        sort_by,
        sort_dir,
        filter_star: star,
        filter_birthday: cake,
      });

      const newItems = data?.items ?? [];
      const newTotal = data?.total ?? 0;

      setItems(newItems);
      console.log("admin-customers first item:", newItems?.[0]);
      setTotal(newTotal);

      return { items: newItems, total: newTotal };
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qApplied, sortKey, onlyStar, onlyCake, offset]);

  async function downloadQR(token: string, fullName?: string | null) {
    try {
      const mod: any = await import("qrcode");
      const QRCode = mod.default ?? mod;

      // ✅ el QR contiene SOLO el token
      const value = (token ?? "").trim();

      const dataUrl = await QRCode.toDataURL(value, { margin: 1, scale: 10 });

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `QR_${(fullName ?? "cliente").replaceAll(" ", "_")}_${value}.png`;
      a.click();
    } catch (e: any) {
      setErr("No pude generar el QR: " + (e?.message ?? String(e)));
    }
  }

  function openWhatsapp(phoneNorm: string | null, fullName: string | null) {
    const digits = onlyDigits(phoneNorm ?? "");
    if (digits.length !== 10) {
      setErr("Teléfono inválido: debe tener 10 dígitos (MX).");
      return;
    }
    const to = `52${digits}`;
    const name = (fullName ?? "cliente").trim();
    const msg = `Hola ${name}, te mandamos tu código QR para tus próximas visitas.`;
    const url = `https://wa.me/${to}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const CakeIcon = ({ title }: { title?: string }) => (
    <img
      src="/icons/birthday-cake.png"
      alt="Cumpleaños"
      title={title ?? "Cumpleaños"}
      className="inline-block align-middle w-[1em] h-[1em]"
      style={{ transform: "translateY(-0.05em)" }}
    />
  );

  function PromoBadge({ kind }: { kind: PromoKind }) {
    if (kind === "promo50") return <span title="Promo">⭐</span>;
    if (kind === "birthday") return <CakeIcon title="Cumpleaños" />;
    return <span title="Normal">⚪</span>;
  }

  // =========================
  // MODAL: EDITAR CLIENTE
  // =========================
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string>("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBirthdate, setEditBirthdate] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState(false);


  function openEdit(it: Item) {
    setErr(null);
    setEditId(it.customer_id);
    setEditName(it.full_name ?? "");
    setEditPhone(it.phone_norm ?? "");
    setEditBirthdate(it.birthdate ? safeDateOnly(it.birthdate) : "");
    setEditOpen(true);
  }

  async function saveEdit() {
    setSaving(true);
    setErr(null);

    try {
      const name = editName.trim();
      const phoneDigits = onlyDigits(editPhone);

      if (phoneDigits.length > 0 && phoneDigits.length !== 10) {
        throw new Error("Teléfono inválido: debe tener 10 dígitos (MX) o vacío.");
      }

      const birth = editBirthdate.trim();
      if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
        throw new Error("Cumpleaños inválido: debe ser YYYY-MM-DD.");
      }

      await invokeAuth("admin-update-customer", {
        customer_id: editId,
        full_name: name.length ? name : null,
        phone_norm: phoneDigits.length ? phoneDigits : null,
        birthdate: birth ? birth : null,
      });

      setEditOpen(false);
      await loadCustomers();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer() {
    if (!editId) return;

    const typed = window.prompt(
      `⚠️ Esto BORRA el cliente y TODAS sus visitas.\n\nEscribe BORRAR para confirmar:`
    );
    if (typed !== "BORRAR") return;

    setDeletingCustomer(true);
    setErr(null);

    try {
      await invokeAuth("admin-delete-customer", { customer_id: editId });

      setEditOpen(false);
      setEditId("");
      setOffset(0);
      await loadCustomers({ offset: 0 }); // recarga lista
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setDeletingCustomer(false);
    }
  }

  // =========================
  // MODAL: NUEVO CLIENTE
  // =========================
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createBirthdate, setCreateBirthdate] = useState("");
  const [creating, setCreating] = useState(false);

  function openCreate() {
    setErr(null);
    setCreateName("");
    setCreatePhone("");
    setCreateBirthdate("");
    setCreateOpen(true);
  }

  async function saveCreate() {
    setCreating(true);
    setErr(null);

    try {
      const name = createName.trim();
      const phoneDigits = onlyDigits(createPhone);
      const birth = createBirthdate.trim();

      if (!name.length) throw new Error("Nombre requerido.");

      if (phoneDigits.length > 0 && phoneDigits.length !== 10) {
        throw new Error("Teléfono inválido: debe tener 10 dígitos (MX) o vacío.");
      }

      if (birth && !/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
        throw new Error("Cumpleaños inválido: debe ser YYYY-MM-DD.");
      }

      await invokeAuth("admin-add-customer", {
        full_name: name,
        phone_norm: phoneDigits.length ? phoneDigits : null,
        birthdate: birth ? birth : null,
      });

      setCreateOpen(false);
      setOffset(0);
      await loadCustomers({ offset: 0 });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  // =========================
  // MODAL: VISITAS
  // =========================
  const [visitsOpen, setVisitsOpen] = useState(false);
  const [visitsCustomer, setVisitsCustomer] = useState<{
    id: string;
    name: string;
    discount_credits: number; // ⭐ acumulable
    birthday_eligible_today: boolean;
  } | null>(null);

  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [vOffset, setVOffset] = useState<number>(0);
  const [vTotal, setVTotal] = useState<number | null>(null);
  const vLimit = 10;

  const [addStartAt, setAddStartAt] = useState<string>(nowLocalInput());
  const [addPromoKind, setAddPromoKind] = useState<PromoKind>("none");
  const [addNotes, setAddNotes] = useState<string>("");

  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [editVisitStartAt, setEditVisitStartAt] = useState<string>("");
  const [editVisitNotes, setEditVisitNotes] = useState<string>("");

  function openVisits(it: Item) {
    setErr(null);
    setVErr(null);
    setVisitsCustomer({
      id: it.customer_id,
      name: it.full_name ?? "Cliente",
      discount_credits: getStarCredits(it),
      birthday_eligible_today: !!it.birthday_eligible_today,
    });
    setVisitsOpen(true);
  }

  async function refreshVisitsCustomerFlagsFromLatest() {
    if (!visitsCustomer) return;
    const found = items.find((x) => x.customer_id === visitsCustomer.id);
    if (!found) return;

    setVisitsCustomer((prev) =>
      prev
        ? {
            ...prev,
            discount_credits: getStarCredits(found),
            birthday_eligible_today: !!found.birthday_eligible_today,
          }
        : prev
    );
  }

  // ✅ Mantén el modal sincronizado con los últimos datos del listado (items)
  useEffect(() => {
    if (!visitsOpen || !visitsCustomer) return;

    const found = items.find((x) => x.customer_id === visitsCustomer.id);
    if (!found) return;

    const credits = getStarCredits(found);
    const bday = !!found.birthday_eligible_today;

    setVisitsCustomer((prev) =>
      prev ? { ...prev, discount_credits: credits, birthday_eligible_today: bday } : prev
    );
  }, [items, visitsOpen, visitsCustomer?.id]);


  async function loadVisits(opts?: { reset?: boolean }) {
    if (!visitsCustomer) return;
    const reset = opts?.reset ?? false;

    setVBusy(true);
    setVErr(null);

    try {
      const offsetToUse = reset ? 0 : vOffset;

      const data = await invokeAuth<{
        ok: true;
        items: Visit[];
        total: number | null;
        limit: number;
        offset: number;
      }>("admin-customer-visits", {
        customer_id: visitsCustomer.id,
        limit: vLimit,
        offset: offsetToUse,
      });

      const its = data.items ?? [];
      const total = data.total ?? null;

      setVisits((prev) => (reset ? its : [...prev, ...its]));
      setVOffset(offsetToUse + its.length);
      setVTotal(total);
    } catch (e: any) {
      setVErr(e?.message ?? String(e));
    } finally {
      setVBusy(false);
    }
  }

  useEffect(() => {
    if (!visitsOpen || !visitsCustomer) return;

    setVisits([]);
    setVOffset(0);
    setVTotal(null);
    setEditingVisitId(null);

    setAddStartAt(nowLocalInput());
    setAddPromoKind("none");
    setAddNotes("");

    loadVisits({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitsOpen, visitsCustomer?.id]);

  async function addVisit() {
    if (!visitsCustomer) return;

    // ✅ usa valores vivos (evita que el modal se quede desfasado)
    const found = items.find((x) => x.customer_id === visitsCustomer.id);
    const liveCredits = found ? getStarCredits(found) : visitsCustomer.discount_credits;
    const liveBday = found ? !!found.birthday_eligible_today : visitsCustomer.birthday_eligible_today;

    if (addPromoKind === "promo50" && liveCredits <= 0) {
      setVErr("Este cliente NO tiene cupón ⭐ disponible.");
      return;
    }
    if (addPromoKind === "birthday" && !liveBday) {
      setVErr("Este cliente NO está en ventana 🎂 (o ya lo canjeó).");
      return;
    }

    setVBusy(true);
    setVErr(null);

    try {
      const iso = new Date(addStartAt).toISOString();

      await invokeAuth("admin-add-visit", {
        customer_id: visitsCustomer.id,
        start_at: iso,
        promo_kind: addPromoKind,
        notes: addNotes.trim().length ? addNotes.trim() : null,
      });

      await loadVisits({ reset: true });
      await loadCustomers(); // ✅ esto actualiza items y el useEffect sincroniza el modal

      setAddNotes("");
      setAddStartAt(nowLocalInput());
      setAddPromoKind("none");
    } catch (e: any) {
      const msg = e?.message ?? String(e);

      if (msg.includes("uq_visits_customer_start") || msg.toLowerCase().includes("duplicate key")) {
        setVErr("Ya existe una visita con esa fecha/hora. Cambia el minuto/segundo (o edita la visita existente).");
      } else {
        setVErr(msg);
      }
    } finally {
      setVBusy(false);
    }
  }


  function startEditVisit(v: Visit) {
    setEditingVisitId(v.id);
    setEditVisitStartAt(toDatetimeLocalValue(v.start_at));
    setEditVisitNotes(v.notes ?? "");
  }

  async function saveVisitEdit(visitId: string) {
    setVBusy(true);
    setVErr(null);

    try {
      const iso = new Date(editVisitStartAt).toISOString();

      await invokeAuth("admin-update-visit", {
        visit_id: visitId,
        start_at: iso,
        notes: editVisitNotes.trim().length ? editVisitNotes.trim() : null,
      });

      setEditingVisitId(null);
      await loadVisits({ reset: true });
      await loadCustomers();
      await refreshVisitsCustomerFlagsFromLatest();
    } catch (e: any) {
      setVErr(e?.message ?? String(e));
    } finally {
      setVBusy(false);
    }
  }

  async function deleteVisit(visitId: string) {
    if (!visitsCustomer) return;

    const ok = window.confirm("¿Seguro que quieres ELIMINAR esta visita? Esto no se puede deshacer.");
    if (!ok) return;

    setVBusy(true);
    setVErr(null);

    try {
      await invokeAuth("admin-delete-visit", {
        visit_id: visitId,
        customer_id: visitsCustomer.id,
      });

      await loadVisits({ reset: true });
      await loadCustomers();
      await refreshVisitsCustomerFlagsFromLatest();
    } catch (e: any) {
      setVErr(e?.message ?? String(e));
    } finally {
      setVBusy(false);
    }
  }

  function doSearch() {
    setOffset(0);
    setQApplied(qInput.trim());
  }

  function onChangeSort(v: SortKey) {
    setOffset(0);
    setSortKey(v);
  }
  function onToggleStar(v: boolean) {
    setOffset(0);
    setOnlyStar(v);
  }
  function onToggleCake(v: boolean) {
    setOffset(0);
    setOnlyCake(v);
  }
  function goPrev() {
    setOffset((prev) => Math.max(0, prev - limit));
  }
  function goNext() {
    setOffset((prev) => prev + limit);
  }

  return (
    <div className="p-6 bg-white text-zinc-900">
      {/* BUSCADOR */}
      <div className="flex items-end gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-sm text-zinc-700 mb-1">Buscar (nombre / teléfono)</label>
          <input
            className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Ej: Victor, 5565318232"
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
          />
        </div>

        <button
          onClick={doSearch}
          disabled={busy}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
        >
          {busy ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {/* FILTROS / ORDEN */}
      <div className="flex flex-wrap items-center gap-5 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-700">Ordenar:</span>
          <select
            className="p-2 rounded border border-zinc-300 bg-white text-zinc-400"
            value={sortKey}
            onChange={(e) => onChangeSort(e.target.value as SortKey)}
            disabled={busy}
          >
            <option value="name_asc">Nombre (A → Z)</option>
            <option value="name_desc">Nombre (Z → A)</option>
            <option value="visits_desc">Visitas (más → menos)</option>
            <option value="visits_asc">Visitas (menos → más)</option>
            <option value="promos_desc">Promos (más → menos)</option>
            <option value="promos_asc">Promos (menos → más)</option>
            <option value="last_desc">Última visita (reciente → vieja)</option>
            <option value="last_asc">Última visita (vieja → reciente)</option>

          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={onlyStar}
            onChange={(e) => onToggleStar(e.target.checked)}
            disabled={busy}
          />
          Solo ⭐ (Cupón disponible)
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={onlyCake}
            onChange={(e) => onToggleCake(e.target.checked)}
            disabled={busy}
          />
          Solo <CakeIcon title="Cumpleaños (ventana activa)" /> (Cumpleaños)
        </label>

        <div className="text-sm text-zinc-600">
          Leyenda: ⭐ = Cupón disponible · <CakeIcon title="Cumpleaños" /> = Cumpleaños disponible · ⚪ = Normal
        </div>

        {/* ✅ BOTÓN NUEVO CLIENTE */}
        <div className="ml-auto">
          <button
            onClick={openCreate}
            disabled={busy}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-purple-500 text-white font-semibold text-base shadow-sm disabled:opacity-60"
          >
            Nuevo cliente
          </button>
        </div>
      </div>

      {(err || vErr) && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800">
          Error: {err ?? vErr}
        </div>
      )}

      <div className="text-zinc-700 text-sm mb-2">
        Total: <b>{total}</b> — mostrando {items.length} — página {Math.floor(offset / limit) + 1}
      </div>

      <div className="overflow-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-100 text-zinc-800">
            <tr>
              <th className="text-left p-3">Nombre</th>
              <th className="text-left p-3">Teléfono</th>
              <th className="text-left p-3">Cumple</th>
              <th className="text-right p-3">Visitas</th>
              <th className="text-right p-3">Promos canjeadas</th>
              <th className="text-left p-3">Última</th>
              <th className="text-left p-3">Acciones</th>
            </tr>
          </thead>

          <tbody className="bg-white text-zinc-900">
            {items.map((it) => {
              const showCake = !!it.birthday_eligible_today;
              const credits = getStarCredits(it);
              const showStar = credits > 0;

              return (
                <tr key={it.customer_id} className="border-t border-zinc-200">
                  <td className="p-3">
                    <span className="font-medium">{it.full_name ?? "-"}</span>

                    {showCake ? (
                      <span className="ml-2">
                        <CakeIcon title="Cumpleaños (ventana activa)" />
                      </span>
                    ) : null}

                    {showStar ? (
                      <span
                        className="ml-2"
                        title={
                          typeof it.discount_credits === "number"
                            ? `Cupones disponibles: ${credits}`
                            : `Cupón disponible (estimado). Visitas=${it.total_visits ?? 0}, Promos=${it.promo_50_ok_cycles ?? 0}`
                        }
                      >
                        ⭐{credits > 1 ? credits : ""}
                      </span>
                    ) : null}
                  </td>

                  <td className="p-3 font-mono">{it.phone_norm ?? "-"}</td>
                  <td className="p-3 font-mono">{it.birthdate ? safeDateOnly(it.birthdate) : "-"}</td>

                  <td className="p-3 text-right">{it.total_visits ?? 0}</td>
                  <td className="p-3 text-right">{it.promo_50_ok_cycles ?? 0}</td>

                  <td className="p-3">{it.last_visit_at ? new Date(it.last_visit_at).toLocaleString() : "-"}</td>

                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="px-3 py-1 rounded bg-zinc-200 text-zinc-900 hover:bg-zinc-300 disabled:opacity-60"
                        disabled={!it.token_prefix}
                        onClick={() => downloadQR(it.token_prefix!, it.full_name)}
                        title="Descargar QR (PNG)"
                      >
                        QR
                      </button>

                      <button
                        className="px-3 py-1 rounded bg-green-500 text-white hover:bg-green-400 disabled:opacity-60"
                        disabled={!it.phone_norm}
                        onClick={() => openWhatsapp(it.phone_norm, it.full_name)}
                        title="Abrir WhatsApp"
                      >
                        WhatsApp
                      </button>

                      <button
                        className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                        onClick={() => openEdit(it)}
                      >
                        Editar
                      </button>

                      <button
                        className="px-3 py-1 rounded bg-zinc-700 text-white hover:bg-zinc-600"
                        onClick={() => openVisits(it)}
                      >
                        Visitas
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {items.length === 0 && (
              <tr>
                <td className="p-3 text-zinc-500" colSpan={7}>
                  {busy ? "Cargando..." : "Sin resultados"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          className="px-3 py-2 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-60 border border-zinc-200"
          disabled={busy || offset === 0}
          onClick={goPrev}
        >
          ◀ Anterior
        </button>
        <button
          className="px-3 py-2 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-60 border border-zinc-200"
          disabled={busy || offset + limit >= total}
          onClick={goNext}
        >
          Siguiente ▶
        </button>
      </div>

      {/* ======================
          MODAL NUEVO CLIENTE ✅
         ====================== */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-zinc-900">Nuevo cliente</h3>
              <button
                className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                ✕
              </button>
            </div>

            <label className="block text-sm text-zinc-700 mb-1">Nombre</label>
            <input
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Nombre completo"
              disabled={creating}
            />

            <label className="block text-sm text-zinc-700 mb-1">Teléfono (10 dígitos, opcional)</label>
            <input
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={createPhone}
              onChange={(e) => setCreatePhone(e.target.value)}
              placeholder="5565318232"
              disabled={creating}
            />

            <label className="block text-sm text-zinc-700 mb-1">Cumpleaños (opcional)</label>
            <input
              type="date"
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-4"
              value={createBirthdate}
              onChange={(e) => setCreateBirthdate(e.target.value)}
              disabled={creating}
            />

            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-60"
                onClick={saveCreate}
                disabled={creating}
              >
                {creating ? "Creando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================
          MODAL EDITAR CLIENTE
         ====================== */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-zinc-900">Editar cliente</h3>
              <button
                className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200"
                onClick={() => setEditOpen(false)}
                disabled={saving || deletingCustomer}
              >
                ✕
              </button>
            </div>

            <label className="block text-sm text-zinc-700 mb-1">Nombre</label>
            <input
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nombre completo"
              disabled={saving || deletingCustomer}
            />

            <label className="block text-sm text-zinc-700 mb-1">Teléfono (10 dígitos)</label>
            <input
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-3"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="5565318232"
              disabled={saving || deletingCustomer}
            />

            <label className="block text-sm text-zinc-700 mb-1">Cumpleaños</label>
            <input
              type="date"
              className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900 mb-4"
              value={editBirthdate}
              onChange={(e) => setEditBirthdate(e.target.value)}
              disabled={saving || deletingCustomer}
            />

            <div className="flex items-center justify-between gap-2">
              <button
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
                onClick={deleteCustomer}
                disabled={saving || deletingCustomer}
                title="Borrar cliente y sus visitas"
              >
                {deletingCustomer ? "Borrando..." : "💀 Borrar"}
              </button>

              <div className="flex gap-2 justify-end">
                <button
                  className="px-4 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                  onClick={() => setEditOpen(false)}
                  disabled={saving || deletingCustomer}
                >
                  Cancelar
                </button>
                <button
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
                  onClick={saveEdit}
                  disabled={saving || deletingCustomer}
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ======================
          MODAL VISITAS
         ====================== */}
      {visitsOpen && visitsCustomer && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          {/* ✅ Modal con altura máxima y layout flex */}
          <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-2xl border border-zinc-200 bg-white flex flex-col">
            {/* ✅ Header fijo (no se va) */}
            <div className="shrink-0 p-4 border-b border-zinc-200 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900">Visitas</h3>
                  <div className="text-sm text-zinc-600 flex items-center gap-2">
                    <span>{visitsCustomer.name}</span>
                    {visitsCustomer.discount_credits > 0 ? (
                      <span title="Cupones disponibles">⭐{visitsCustomer.discount_credits}</span>
                    ) : null}
                    {visitsCustomer.birthday_eligible_today ? (
                      <span title="Cumpleaños (ventana activa)">
                        <CakeIcon title="Cumpleaños (ventana activa)" />
                      </span>
                    ) : null}
                  </div>
                </div>

                <button
                  className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200"
                  onClick={() => setVisitsOpen(false)}
                  disabled={vBusy}
                  title="Cerrar"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* ✅ Sección “Agregar visita” fija (no se va) */}
            <div className="shrink-0 p-4 border-b border-zinc-200 bg-white">
              <div className="rounded-xl border border-zinc-200 p-3 bg-zinc-50">
                <div className="text-sm text-zinc-800 mb-2 font-medium">Agregar visita</div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-xs text-zinc-600 mb-1">Fecha/hora</label>
                    <input
                      type="datetime-local"
                      step={1}
                      className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
                      value={addStartAt}
                      onChange={(e) => setAddStartAt(e.target.value)}
                      disabled={vBusy}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-600 mb-1">
                      Promo{" "}
                      <span className="ml-1 inline-block align-middle">
                        <PromoBadge kind={addPromoKind} />
                      </span>
                    </label>

                    <select
                      className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
                      value={addPromoKind}
                      onChange={(e) => setAddPromoKind(e.target.value as PromoKind)}
                      disabled={vBusy}
                    >
                      <option value="none">Normal</option>
                      <option value="promo50">Promo</option>
                      <option value="birthday">Cumpleaños</option>
                    </select>

                    <div className="text-[11px] text-zinc-500 mt-1">
                      ⭐ requiere cupón disponible · <CakeIcon title="Cumpleaños" /> requiere ventana activa
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs text-zinc-600 mb-1">Notas (opcional)</label>
                    <input
                      className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      placeholder="Ej: corte + barba"
                      disabled={vBusy}
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-2">
                  <button
                    className="px-3 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                    disabled={vBusy}
                    onClick={async () => {
                      await loadVisits({ reset: true });
                      await loadCustomers();
                    }}
                  >
                    Refrescar
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-60"
                    disabled={vBusy}
                    onClick={addVisit}
                  >
                    {vBusy ? "Procesando..." : "+ Agregar"}
                  </button>
                </div>

                {vErr && (
                  <div className="mt-3 p-3 rounded bg-red-50 border border-red-200 text-red-800">
                    Error: {vErr}
                  </div>
                )}
              </div>
            </div>

            {/* ✅ LISTA SCROLLEABLE (aquí aparece la barra vertical) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-100 text-zinc-800 sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-3">Fecha</th>
                      <th className="text-left p-3">Notas</th>
                      <th className="text-left p-3">Agregado por</th>
                      <th className="text-right p-3">Acciones</th>
                    </tr>
                  </thead>

                  <tbody className="bg-white text-zinc-900">
                    {visits.map((v) => {
                      const isEditing = editingVisitId === v.id;
                      const kind = (v.promo_kind ?? "none") as PromoKind;

                      return (
                        <tr key={v.id} className="border-t border-zinc-200 align-top">
                          <td className="p-3">
                            {isEditing ? (
                              <input
                                type="datetime-local"
                                step={1}
                                className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
                                value={editVisitStartAt}
                                onChange={(e) => setEditVisitStartAt(e.target.value)}
                                disabled={vBusy}
                              />
                            ) : (
                              <div>
                                <div className="flex items-center gap-2">
                                  <PromoBadge kind={kind} />
                                  <span>{new Date(v.start_at).toLocaleString()}</span>
                                </div>
                                <div className="text-xs text-zinc-500 font-mono">{v.id}</div>
                              </div>
                            )}
                          </td>

                          <td className="p-3">
                            {isEditing ? (
                              <input
                                className="w-full p-2 rounded border border-zinc-300 bg-white text-zinc-900"
                                value={editVisitNotes}
                                onChange={(e) => setEditVisitNotes(e.target.value)}
                                disabled={vBusy}
                              />
                            ) : (
                              <div className="whitespace-pre-wrap">{v.notes ?? ""}</div>
                            )}
                          </td>

                          <td className="p-3">{v.added_by_email ?? "importado"}</td>

                          <td className="p-3 text-right">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
                                  disabled={vBusy}
                                  onClick={() => saveVisitEdit(v.id)}
                                >
                                  Guardar
                                </button>
                                <button
                                  className="px-3 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                                  disabled={vBusy}
                                  onClick={() => setEditingVisitId(null)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button
                                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
                                  disabled={vBusy}
                                  onClick={() => startEditVisit(v)}
                                >
                                  Editar
                                </button>
                                <button
                                  className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
                                  disabled={vBusy}
                                  onClick={() => deleteVisit(v.id)}
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {visits.length === 0 && (
                      <tr>
                        <td className="p-3 text-zinc-500" colSpan={4}>
                          {vBusy ? "Cargando..." : "Sin visitas"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ✅ Footer fijo (siempre visible) */}
            <div className="shrink-0 p-4 border-t border-zinc-200 bg-white">
              <div className="flex justify-end gap-2">
                {(vTotal === null || vOffset < vTotal) && (
                  <button
                    className="px-3 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                    disabled={vBusy}
                    onClick={() => loadVisits({ reset: false })}
                  >
                    Cargar más
                  </button>
                )}

                <button
                  className="px-3 py-2 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 disabled:opacity-60"
                  disabled={vBusy}
                  onClick={() => setVisitsOpen(false)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
