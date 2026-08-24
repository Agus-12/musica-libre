import { NextResponse } from "next/server";
import { baseMac, guardarBaseMac } from "@/app/utils/servidorCasa";

/* ═══════════════════════════════════════════════════════════════
   /api/tunel — el túnel de la Mac se AUTO-CURA
   POST {url, token} → la Mac avisa su URL nueva de trycloudflare
                       cada vez que el túnel arranca o cambia.
   GET  ?token=...    → ver la URL actual (diagnóstico).
   Protegido con MUSICA_TOKEN (el mismo del servidor de casa).
   ═══════════════════════════════════════════════════════════════ */

export async function POST(req) {
  const { url, token } = await req.json().catch(() => ({}));
  if (!process.env.MUSICA_TOKEN || token !== process.env.MUSICA_TOKEN) {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }
  const limpia = String(url || "").trim().replace(/\/+$/, "");
  /* Solo URLs de túneles conocidos: nadie puede apuntar la app a un
     servidor pirata aunque adivine el token. */
  if (!/^https:\/\/[a-z0-9-]+\.(trycloudflare\.com|ts\.net)$/i.test(limpia)) {
    return NextResponse.json({ error: "esa URL no parece un túnel válido" }, { status: 400 });
  }
  /* Verificar que de verdad es NUESTRA Mac: le preguntamos /salud */
  try {
    const r = await fetch(`${limpia}/salud`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const d = await r.json();
    if (!d || d.ok !== true) throw new Error("salud no ok");
  } catch {
    return NextResponse.json({ error: "esa URL no responde como el servidor de AURA" }, { status: 400 });
  }
  const res = await guardarBaseMac(limpia);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, url: limpia });
}

export async function GET(req) {
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!process.env.MUSICA_TOKEN || token !== process.env.MUSICA_TOKEN) {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }
  const url = await baseMac();
  return NextResponse.json({ url: url || "(sin configurar)" });
}
