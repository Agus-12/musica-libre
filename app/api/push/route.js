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
  const body = await req.json().catch(() => ({}));

  /* ── Aviso AUTOMÁTICO de versión nueva ─────────────────────────
     Lo llama la app del PRIMER usuario que detecta la actualización.
     El servidor deduplica por huella de build (app_config): el push
     a todos sale UNA sola vez por deploy, sin tocar nada a mano. */
  if (body.avisar_version) {
    try {
      const { enviarPush } = await import("@/app/utils/push");
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return NextResponse.json({ ok: false, motivo: "faltan claves en Vercel" });
      const admin = createAdmin(url, key, { auth: { persistSession: false } });

      // Huella del build actual, leída del propio sw.js desplegado
      let build = "";
      try {
        const sw = await fetch(new URL("/sw.js", req.url), { cache: "no-store" }).then(r => r.text());
        build = (sw.match(/AURA_BUILD = "([^"]+)"/) || [])[1] || "";
      } catch {}
      if (!build || build === "dev") return NextResponse.json({ ok: false, motivo: "sin huella de build" });

      /* Dedupe por CONTENIDO de novedades, no por build: así los deploys
         de arreglos chiquitos (sin novedades nuevas) no spamean pushes.
         El banner dentro de la app sí aparece siempre. */
      let cuerpo = "Abrí AURA y tocá Actualizar para tenerla.";
      let firmaNov = build;
      try {
        const nov = await fetch(new URL("/novedades.json", req.url), { cache: "no-store" }).then(r => r.json());
        if (nov.cambios && nov.cambios.length) {
          cuerpo = nov.cambios[0] + " …y más. Abrí AURA para actualizar.";
          const texto = JSON.stringify(nov.cambios) + (nov.version || "");
          let h = 0;
          for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) | 0;
          firmaNov = String(h);
        }
      } catch {}

      const { data: previo } = await admin.from("app_config").select("valor").eq("clave", "ultima_version_avisada").maybeSingle();
      if (previo && previo.valor === firmaNov) {
        return NextResponse.json({ ok: true, ya_avisado: true });
      }
      // Marcamos ANTES de enviar (si dos lo piden a la vez, solo pasa uno)
      await admin.from("app_config").upsert({ clave: "ultima_version_avisada", valor: firmaNov, actualizado: new Date().toISOString() });
      const resultado = await enviarPush(null, { titulo: "AURA se actualizó 🎉", cuerpo, url: "/spotify" });
      return NextResponse.json({ ok: true, ...resultado });
    } catch (e) {
      return NextResponse.json({ ok: false, motivo: String(e.message || e).slice(0, 100) });
    }
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { subscription } = body;
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
