import { NextResponse } from "next/server";
import { baseMac } from "@/app/utils/servidorCasa";

/* ═══════════════════════════════════════════════════
   /api/borrar-cancion — le pide a la Mac borrar el audio

   Cuando el usuario saca una canción de sus descargas,
   la app llama a esta ruta y esta le pide a la Mac
   (servidor casero) que borre su copia del archivo,
   para no ocupar espacio de más.

   Si la Mac está apagada o el túnel caído, no es grave:
   respondemos ok de todas formas y el límite de disco
   de la Mac igual limpia lo viejo con el tiempo.
   ═══════════════════════════════════════════════════ */

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const videoId = p.get("video_id") || p.get("v") || "";
  const query = p.get("q") || "";

  if (!videoId && !query) {
    return NextResponse.json({ ok: false, error: "falta video_id" }, { status: 400 });
  }

  const base = await baseMac();
  if (!base) {
    return NextResponse.json({ ok: false, error: "MUSICA_SERVER vacía" });
  }

  const token = process.env.MUSICA_TOKEN || "";
  const qs = new URLSearchParams();
  if (videoId) qs.set("v", videoId);
  if (query) qs.set("q", query);
  if (p.get("rechazar") === "1") qs.set("rechazar", "1");
  if (token) qs.set("token", token);

  try {
    const resp = await fetch(`${base}/borrar?${qs}`, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json(
      { ok: resp.ok, ...data },
      { status: resp.ok ? 200 : 502 }
    );
  } catch (e) {
    // La Mac está apagada o el túnel caído: no es un error del usuario.
    return NextResponse.json({
      ok: false,
      error: "Mac no disponible",
      detalle: String(e.message || e).slice(0, 100),
    });
  }
}
