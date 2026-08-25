import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

const PLANES = {
  mensual: { titulo: "AURA Premium por 30 días", precio: 26, dias: 30 },
  anual: { titulo: "AURA Premium por 365 días", precio: 260, dias: 365 },
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
  const payerEmail = process.env.MP_TEST_PAYER_EMAIL || user.email;
  const base = new URL(req.url).origin;
  const external = `aura:${user.id}:${plan}`;
  const payload = {
    items: [{ id: `aura-premium-${plan}`, title: p.titulo, description: "Acceso Premium de AURA", quantity: 1, currency_id: "MXN", unit_price: p.precio }],
    payer: { email: payerEmail },
    external_reference: external,
    back_urls: { success: `${base}/pago/resultado?estado=exito`, failure: `${base}/pago/resultado?estado=fallo`, pending: `${base}/pago/resultado?estado=pendiente` },
    auto_return: "approved",
    notification_url: `${base}/api/pagos/webhook`,
    statement_descriptor: "AURA PREMIUM",
  };
  const r = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !(d.sandbox_init_point || d.init_point)) {
    const detalle = Array.isArray(d.cause) ? d.cause.map(c => [c.code, c.description, c.message].filter(Boolean).join(" — ")).join(" | ") : (d.cause || d.message || d.error || "respuesta no especificada");
    console.error("Mercado Pago crear checkout:", r.status, JSON.stringify(d));
    return NextResponse.json({ error: "Mercado Pago rechazó el pago", detalle: String(detalle).slice(0, 900) }, { status: 400 });
  }
  return NextResponse.json({ ok: true, init_point: d.sandbox_init_point || d.init_point, plan });
}
