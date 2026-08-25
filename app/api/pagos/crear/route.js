import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

const PLANES = {
  mensual: { titulo: "AURA Premium mensual", precio: 26, dias: 30 },
  anual: { titulo: "AURA Premium anual", precio: 260, dias: 365 },
};

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "Falta MP_ACCESS_TOKEN en Vercel" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const plan = PLANES[body.plan] ? body.plan : "mensual";
  const p = PLANES[plan];
  const base = new URL(req.url).origin;
  const external = `aura:${user.id}:${plan}`;
  // En pruebas, Mercado Pago exige que el pagador también sea un usuario
  // de prueba. Se configura su correo en MP_TEST_PAYER_EMAIL; en producción
  // usamos el correo real de la cuenta de AURA.
  const payerEmail = process.env.MP_TEST_PAYER_EMAIL || user.email;
  const payload = {
    reason: p.titulo,
    external_reference: external,
    payer_email: payerEmail,
    back_url: `${base}/profile?pago=regreso`,
    auto_recurring: { frequency: plan === "anual" ? 12 : 1, frequency_type: "months", transaction_amount: p.precio, currency_id: "MXN" },
    status: "pending",
  };
  const r = await fetch("https://api.mercadopago.com/preapproval", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detalle = Array.isArray(d.cause)
      ? d.cause.map(c => [c.code, c.description, c.message].filter(Boolean).join(" — ")).join(" | ")
      : (d.cause || d.message || d.error || "respuesta no especificada");
    console.error("Mercado Pago crear suscripción:", r.status, JSON.stringify(d));
    return NextResponse.json({ error: "Mercado Pago rechazó la suscripción", detalle: String(detalle).slice(0, 900) }, { status: 400 });
  }
  await supabase.from("suscripciones").upsert({ user_id: user.id, plan: "free", estado: "pending", proveedor: "mercado_pago", mp_preapproval_id: d.id ? String(d.id) : null, mp_payer_email: payerEmail, actualizado: new Date().toISOString() });
  return NextResponse.json({ ok: true, init_point: d.sandbox_init_point || d.init_point, id: d.id, plan });
}
