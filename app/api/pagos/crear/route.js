import { createClient } from "@/app/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const PLANES = {
  mensual: { titulo: "AURA Premium mensual", precio: 26, frecuencia: 1 },
  anual: { titulo: "AURA Premium anual", precio: 260, frecuencia: 12 },
};

function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
}

async function obtenerPlanMp(db, token, plan, base) {
  const clave = `mp_plan_${plan}`;
  const { data: guardado } = await db.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  if (guardado?.valor) return guardado.valor;
  const p = PLANES[plan];
  const r = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: p.titulo, external_reference: `aura-plan:${plan}`, back_url: `${base}/profile?pago=regreso`, auto_recurring: { frequency: p.frecuencia, frequency_type: "months", transaction_amount: p.precio, currency_id: "MXN" } }),
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) throw new Error(`No se pudo crear el plan ${plan}: ${d.message || d.error || JSON.stringify(d)}`);
  await db.from("app_config").upsert({ clave, valor: String(d.id), actualizado: new Date().toISOString() });
  return String(d.id);
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "Falta MP_ACCESS_TOKEN en Vercel" }, { status: 500 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const plan = PLANES[body.plan] ? body.plan : "mensual";
  const card = body.card || {};
  const cardToken = card.token || card.card_token_id || "";
  if (!cardToken) return NextResponse.json({ error: "Falta el token seguro de la tarjeta" }, { status: 400 });
  const base = new URL(req.url).origin;
  const external = `aura:${user.id}:${plan}`;
  const payerEmail = process.env.MP_TEST_PAYER_EMAIL || user.email;
  try {
    let planId = await obtenerPlanMp(db, token, plan, base);
    const makePayload = () => ({ reason: PLANES[plan].titulo, external_reference: external, payer_email: payerEmail, preapproval_plan_id: planId, card_token_id: cardToken, back_url: `${base}/profile?pago=regreso`, status: "authorized" });
    let r = await fetch("https://api.mercadopago.com/preapproval", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(makePayload()), cache: "no-store" });
    let d = await r.json().catch(() => ({}));
    // Un plan guardado con credenciales anteriores puede quedar inválido.
    // Si MP responde 404, lo descartamos y lo recreamos una sola vez.
    if (!r.ok && (r.status === 404 || /resource not found|not_found/i.test(JSON.stringify(d)))) {
      await db.from("app_config").delete().eq("clave", `mp_plan_${plan}`);
      planId = await obtenerPlanMp(db, token, plan, base);
      r = await fetch("https://api.mercadopago.com/preapproval", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(makePayload()), cache: "no-store" });
      d = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      const detalle = Array.isArray(d.cause) ? d.cause.map(c => [c.code, c.description, c.message].filter(Boolean).join(" — ")).join(" | ") : (d.cause || d.message || d.error || "respuesta no especificada");
      console.error("Mercado Pago crear suscripción:", r.status, JSON.stringify(d));
      return NextResponse.json({ error: "Mercado Pago rechazó la suscripción", detalle: String(detalle).slice(0, 900) }, { status: 400 });
    }
    await supabase.from("suscripciones").upsert({ user_id: user.id, plan: "free", estado: "pending", proveedor: "mercado_pago", mp_preapproval_id: d.id ? String(d.id) : null, mp_payer_email: payerEmail, actualizado: new Date().toISOString() });
    return NextResponse.json({ ok: true, init_point: d.sandbox_init_point || d.init_point, id: d.id, plan });
  } catch (e) {
    return NextResponse.json({ error: "No se pudo preparar el plan de Mercado Pago", detalle: String(e.message || e).slice(0, 900) }, { status: 400 });
  }
}
