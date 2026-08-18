import { NextResponse } from "next/server";

/* /api/letras — letras de canciones vía lrclib.net (gratis, sin key).
   GET ?artista=&cancion=&dur=   →  { plain, synced }
   synced viene en formato LRC: [mm:ss.xx] línea  (para karaoke). */

async function pedirLrclib(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "AURA/1.0 (app de musica personal)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const artista = (p.get("artista") || "").trim();
  const cancion = (p.get("cancion") || "").trim();
  const dur = Number(p.get("dur")) || 0;
  if (!artista && !cancion) return NextResponse.json({ error: "Falta artista/cancion" }, { status: 400 });

  try {
    const base = "https://lrclib.net/api";
    let d = null;

    // 1. Búsqueda exacta (con duración ayuda a elegir la versión correcta)
    const q1 = new URLSearchParams({ artist_name: artista, track_name: cancion });
    if (dur > 0) q1.set("duration", String(Math.round(dur)));
    d = await pedirLrclib(base + "/get?" + q1);

    // 2. Sin duración
    if (!d || (!d.plainLyrics && !d.syncedLyrics)) {
      d = await pedirLrclib(base + "/get?" + new URLSearchParams({ artist_name: artista, track_name: cancion }));
    }

    // 3. Búsqueda difusa: primer resultado con letra
    if (!d || (!d.plainLyrics && !d.syncedLyrics)) {
      const lista = await pedirLrclib(base + "/search?" + new URLSearchParams({ q: (artista + " " + cancion).trim() }));
      if (Array.isArray(lista)) {
        d = lista.find(x => x.syncedLyrics) || lista.find(x => x.plainLyrics) || null;
      }
    }

    if (!d || (!d.plainLyrics && !d.syncedLyrics)) {
      return NextResponse.json({ plain: "", synced: "", encontrada: false });
    }

    const resp = NextResponse.json({
      plain: d.plainLyrics || "",
      synced: d.syncedLyrics || "",
      encontrada: true,
      titulo: d.trackName || cancion,
      artista: d.artistName || artista,
    });
    // Las letras no cambian: caché fuerte en el edge
    resp.headers.set("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000");
    return resp;
  } catch (e) {
    return NextResponse.json({ plain: "", synced: "", encontrada: false, error: String(e.message || e) });
  }
}
