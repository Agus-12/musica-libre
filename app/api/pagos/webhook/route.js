import { createClient as createSupabase } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function datosRef(ref) { const m = String(ref || "").match(/^aura:([^:]+):(mensual|anual)$/); return m ? { uid: m[1], plan: m[2] } : { uid: null, plan: "mensual" }; }

export async function POST(req) {
  const db = adminDb();
  if (!db) return NextResponse.json({ ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const type = body.type || body.topic || req.nextUrl.searchParams.get("type") || req.nextUrl.searchParams.get("topic");
  const id = body.data?.id || req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: true });
  const token = process.env.MP_ACCESS_TOKEN;
  try {
    let resource;
    if (type === "subscription_preapproval" || type === "preapproval") {
      const r = await fetch(`https://api.mercadopago.com/preapproval/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      resource = await r.json();
    } else if (type === "payment") {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      resource = await r.json();
    } else return NextResponse.json({ ok: true });
    const ref = datosRef(resource.external_reference);
    const uid = ref.uid;
    if (!uid) return NextResponse.json({ ok: true });
    const sub = type === "payment" ? { mp_last_payment_id: String(id), estado: resource.status === "approved" ? "active" : resource.status === "pending" ? "pending" : "rejected" } : { mp_preapproval_id: String(id), estado: resource.status === "authorized" ? "active" : resource.status === "paused" ? "paused" : resource.status === "cancelled" ? "cancelled" : "pending" };
    if (sub.estado === "active") { sub.plan = "premium"; sub.vence_en = new Date(Date.now() + (ref.plan === "anual" ? 365 : 30) * 86400000).toISOString(); }
    await db.from("suscripciones").upsert({ user_id: uid, ...sub, proveedor: "mercado_pago", actualizado: new Date().toISOString() });
  } catch {}
  return NextResponse.json({ ok: true });
}
