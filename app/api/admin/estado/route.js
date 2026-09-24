import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";
import { baseMac } from "@/app/utils/servidorCasa";

async function esOwner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user && process.env.ADMIN_USER_ID && user.id === process.env.ADMIN_USER_ID);
}

export async function GET() {
  if (!(await esOwner())) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const base = await baseMac();
  const estado = { web: "ok", mac: "sin señal", tunel: "sin configurar", url: base || "", salud: null };
  if (!base) return NextResponse.json(estado);
  estado.tunel = "respondiendo";
  try {
    const r = await fetch(`${base}/salud?token=${encodeURIComponent(process.env.MUSICA_TOKEN || "12345")}`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const d = await r.json();
    estado.salud = d;
    estado.mac = d?.ok ? "ok" : "error";
    if (!d?.ok) estado.tunel = "error";
  } catch { estado.tunel = "no responde"; }
  return NextResponse.json(estado);
}
