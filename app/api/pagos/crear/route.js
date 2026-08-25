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
  const base = new URL(req.url).origin;
  const external = `aura:${user.id}:${plan}`;
  /* Sandbox (token de prueba "TEST-...") vs producción ("APP_USR-..."):
     - En sandbox NO usamos sandbox_init_point ni auto_return: ambas cosas
       provocan bucles de redirección en x.mercadopago.com.mx al finalizar
       el cobro (falla reportada con Safari y con cuentas de prueba).
       Con credenciales de prueba, init_point abre igual el checkout de
       sandbox, y el botón "Volver al sitio" regresa sin bucles.
     - En producción el auto-retorno queda activo como siempre.
     - El email de tester SOLO se usa en sandbox. Si queda MP_TEST_PAYER_EMAIL
       en Vercel con claves reales, el cobro iría a la cuenta de prueba. */
  const esSandbox = String(token).startsWith("TEST-");
  const payerEmail = (esSandbox && process.env.MP_TEST_PAYER_EMAIL) || user.email;
  const payload = {
    items: [{ id: `aura-premium-${plan}`, title: p.titulo, description: "Acceso Premium de AURA", quantity: 1, currency_id: "MXN", unit_price: p.precio }],
    payer: { email: payerEmail },
    external_reference: external,
    back_urls: { success: `${base}/pago/resultado?estado=exito`, failure: `${base}/pago/resultado?estado=fallo`, pending: `${base}/pago/resultado?estado=pendiente` },
    ...(esSandbox ? {} : { auto_return: "approved" }),
    notification_url: `${base}/api/pagos/webhook`,
    statement_descriptor: "AURA PREMIUM",
  };
  const r = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !(d.init_point || d.sandbox_init_point)) {
    const detalle = Array.isArray(d.cause) ? d.cause.map(c => [c.code, c.description, c.message].filter(Boolean).join(" — ")).join(" | ") : (d.cause || d.message || d.error || "respuesta no especificada");
    console.error("Mercado Pago crear checkout:", r.status, JSON.stringify(d));
    return NextResponse.json({ error: "Mercado Pago rechazó el pago", detalle: String(detalle).slice(0, 900) }, { status: 400 });
  }
  /* init_point primero: con credenciales de prueba igual abre el checkout
     de sandbox, y evita los bucles conocidos de sandbox_init_point. */
  return NextResponse.json({ ok: true, init_point: d.init_point || d.sandbox_init_point, plan, sandbox: esSandbox });
}
