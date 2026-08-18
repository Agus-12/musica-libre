import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";
import { enviarPush } from "@/app/utils/push";

/* /api/push — Web Push real
   POST {subscription}          → registrar este dispositivo
   DELETE {endpoint}            → dar de baja este dispositivo
   GET ?avisar=version&token=X  → avisar a TODOS que hay versión nueva
                                  (X = MUSICA_TOKEN; para llamarlo tras
                                   cada deploy)                         */

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { subscription } = await req.json().catch(() => ({}));
  if (!subscription || !subscription.endpoint) {
    return NextResponse.json({ error: "Falta subscription" }, { status: 400 });
  }
  // upsert por (user, endpoint): re-suscribirse no duplica
  const { error } = await supabase.from("push_subs").upsert(
    { user_id: user.id, subscription },
    { onConflict: "user_id,endpoint", ignoreDuplicates: false }
  );
  if (error) {
    return NextResponse.json({ error: "Corré supabase-push.sql en Supabase", detalle: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) {
    await supabase.from("push_subs").delete().eq("user_id", user.id).eq("endpoint", endpoint);
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  if (p.get("avisar") !== "version") {
    return NextResponse.json({ error: "uso: ?avisar=version&token=..." }, { status: 400 });
  }
  const token = p.get("token") || "";
  if (!process.env.MUSICA_TOKEN || token !== process.env.MUSICA_TOKEN) {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }
  // Tomamos el título de las novedades para el cuerpo de la notificación
  let cuerpo = "Abrí AURA y tocá Actualizar para tenerla.";
  try {
    const nov = await fetch(new URL("/novedades.json", req.url), { cache: "no-store" }).then(r => r.json());
    if (nov.cambios && nov.cambios.length) cuerpo = nov.cambios[0] + " …y más. Abrí AURA para actualizar.";
  } catch {}
  const resultado = await enviarPush(null, {
    titulo: "AURA se actualizó 🎉",
    cuerpo,
    url: "/spotify",
  });
  return NextResponse.json({ ok: true, ...resultado });
}
