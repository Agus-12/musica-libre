import { NextResponse } from "next/server";

export const maxDuration = 60;   // playlists grandes: buscar carátulas toma unos segundos

/* ═══════════════════════════════════════════════════════════════
   /api/importar-playlist?url=...
   Lee una playlist EXTERNA por su link y devuelve las canciones:
   - Spotify:  open.spotify.com/playlist/...  (vía su página embed,
               sin credenciales; si hay SPOTIFY_CLIENT_ID/SECRET en
               Vercel, usa la API oficial que es más completa)
   - Deezer:   deezer.com/playlist/... o links cortos link.deezer.com
   Devuelve { nombre, cover, canciones: [{name, artist, cover,
   duration_ms, album_id, preview_url, source}] }
   ═══════════════════════════════════════════════════════════════ */

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/* La página embed de Spotify NO trae la carátula de cada canción (solo la
   de la playlist). Buscamos cada canción en Deezer para ponerle su
   carátula ORIGINAL del álbum + preview + duración real. En paralelo
   (8 a la vez) para que no tarde. */
async function enriquecerConDeezer(canciones) {
  const out = [...canciones];
  let i = 0;
  const worker = async () => {
    while (i < out.length && i < 200) {
      const idx = i++;
      const c = out[idx];
      if (c.cover_real) continue;
      try {
        const art = (c.artist || "").split(",")[0].trim();
        let q = `artist:"${art}" track:"${(c.name || "").replace(/"/g, "")}"`;
        let r = await fetch("https://api.deezer.com/search?q=" + encodeURIComponent(q) + "&limit=1", { headers: { "User-Agent": UA } }).then(x => x.json()).catch(() => null);
        let t = r?.data?.[0];
        if (!t) {
          r = await fetch("https://api.deezer.com/search?q=" + encodeURIComponent(`${art} ${c.name}`) + "&limit=1", { headers: { "User-Agent": UA } }).then(x => x.json()).catch(() => null);
          t = r?.data?.[0];
        }
        if (t) {
          out[idx] = {
            ...c,
            cover: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || c.cover,
            album_id: c.album_id || (t.album?.id ? String(t.album.id) : ""),
            preview_url: c.preview_url || t.preview || "",
            duration_ms: c.duration_ms || (t.duration || 0) * 1000,
            source: "deezer",
          };
        }
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

async function importarDeezer(playlistId) {
  const r = await fetch(`https://api.deezer.com/playlist/${playlistId}?limit=300`, { headers: { "User-Agent": UA } });
  const d = await r.json();
  if (!d || d.error) throw new Error("Deezer no encontró esa playlist");
  let data = d.tracks?.data || [];
  /* Playlists largas: seguir pidiendo páginas (hasta 500 canciones) */
  try {
    let next = d.tracks?.next;
    while (next && data.length < 500) {
      const p = await fetch(next, { headers: { "User-Agent": UA } }).then(x => x.json());
      data = data.concat(p.data || []);
      next = p.next;
    }
  } catch {}
  const canciones = data.slice(0, 500).map(t => ({
    name: t.title || "",
    artist: t.artist?.name || "",
    cover: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || "",
    duration_ms: (t.duration || 0) * 1000,
    album_id: t.album?.id ? String(t.album.id) : "",
    preview_url: t.preview || "",
    source: "deezer",
  })).filter(c => c.name);
  return { nombre: d.title || "Playlist", cover: d.picture_xl || d.picture_big || "", canciones };
}

async function spotifyConCredenciales(playlistId) {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const tk = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
    body: "grant_type=client_credentials",
  }).then(r => r.json()).catch(() => null);
  if (!tk?.access_token) return null;
  const pl = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`, {
    headers: { Authorization: "Bearer " + tk.access_token },
  }).then(r => r.json()).catch(() => null);
  if (!pl?.name) return null;
  /* Canciones con paginación: hasta 500 (la página embed solo da ~100) */
  let items = [], next = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(name,duration_ms,artists(name),album(images))),next`;
  while (next && items.length < 500) {
    const pg = await fetch(next, { headers: { Authorization: "Bearer " + tk.access_token } }).then(r => r.json()).catch(() => null);
    if (!pg) break;
    items = items.concat(pg.items || []);
    next = pg.next;
  }
  const canciones = items.map(({ track: t }) => t && ({
    name: t.name || "",
    artist: (t.artists || []).map(a => a.name).join(", "),
    cover: t.album?.images?.[0]?.url || "",
    cover_real: true,
    duration_ms: t.duration_ms || 0,
    album_id: "",
    preview_url: "",
    source: "spotify",
  })).filter(c => c && c.name);
  return { nombre: pl.name, cover: pl.images?.[0]?.url || "", canciones };
}

async function importarSpotify(playlistId) {
  /* 1) API oficial si hay credenciales configuradas */
  const oficial = await spotifyConCredenciales(playlistId).catch(() => null);
  if (oficial && oficial.canciones.length) return oficial;

  /* 2) Página embed pública (sin credenciales) */
  const html = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { "User-Agent": UA, "Accept-Language": "es" },
  }).then(r => r.text());
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Spotify cambió su página y no pude leer la playlist. Prueba con una de Deezer, o configura SPOTIFY_CLIENT_ID/SECRET en Vercel.");
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new Error("No pude leer los datos de Spotify"); }
  /* La estructura se mueve entre versiones: buscamos el trackList donde sea */
  const buscar = (obj, prof = 0) => {
    if (!obj || typeof obj !== "object" || prof > 8) return null;
    if (Array.isArray(obj.trackList) && obj.trackList.length) return obj;
    for (const v of Object.values(obj)) {
      const r = buscar(v, prof + 1);
      if (r) return r;
    }
    return null;
  };
  const ent = buscar(data);
  if (!ent) throw new Error("Spotify no dejó leer esa playlist (¿es privada?). Prueba con Deezer o configura credenciales de Spotify en Vercel.");
  const cover = ent.coverArt?.sources?.slice(-1)[0]?.url || ent.images?.[0]?.url || "";
  const canciones = ent.trackList.map(t => ({
    name: t.title || t.name || "",
    artist: t.subtitle || (t.artists || []).map(a => a.name).join(", ") || "",
    cover,
    duration_ms: t.duration || t.duration_ms || 0,
    album_id: "",
    preview_url: "",
    source: "spotify",
  })).filter(c => c.name);
  if (!canciones.length) throw new Error("La playlist salió vacía");
  /* Carátulas ORIGINALES de cada canción (el embed solo da la de la playlist) */
  const conCaratulas = await enriquecerConDeezer(canciones);
  return { nombre: ent.name || ent.title || "Playlist", cover, canciones: conCaratulas };
}

export async function GET(req) {
  let url = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!url) return NextResponse.json({ error: "Falta la URL" }, { status: 400 });

  /* La gente pega el texto COMPLETO que comparte la app ("Mira esta
     playlist... https://..."): pescamos la primera URL que venga. */
  const enTexto = url.match(/https?:\/\/[^\s"'<>]+/);
  if (enTexto) url = enTexto[0];
  /* URI nativa de Spotify: spotify:playlist:ID */
  const uriSp = url.match(/spotify:playlist:([A-Za-z0-9]+)/i);
  if (uriSp) url = "https://open.spotify.com/playlist/" + uriSp[1];
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  try {
    /* Links CORTOS (los que da "Compartir" en el cel): seguimos la
       redirección hasta el link real.
       - Spotify: spotify.link/xxx, spoti.fi/xxx y el nuevo open.spotify.com/s/xxx
         (OJO: /s/ SOLO redirige si el request parece un celular)
       - Deezer:  link.deezer.com, dzr.page.link */
    if (/spotify\.link|spoti\.fi|link\.tospotify\.com|open\.spotify\.com\/s\/|link\.deezer\.com|dzr\.page\.link/i.test(url)) {
      /* Primero leemos el Location a mano: es el link directo y limpio.
         OJO: puede venir RELATIVO ("/playlist/..."), hay que completarlo
         con el dominio original. */
      try {
        const r2 = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
        const loc = r2.headers.get("location");
        if (loc) url = new URL(loc, url).toString();
      } catch {}
      /* Si no hubo Location, seguimos redirecciones normales */
      if (!/playlist/i.test(url)) {
        try {
          const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA } });
          url = r.url || url;
        } catch {}
      }
    }

    let dz = url.match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
    if (dz) return NextResponse.json(await importarDeezer(dz[1]));

    /* Formato normal, con región (intl-es) o el viejo con /user/ */
    let sp = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?playlist\/([A-Za-z0-9]+)/i);
    if (sp) return NextResponse.json(await importarSpotify(sp[1]));

    /* Plan B: el id de playlist donde sea que venga (hasta codificado
       dentro de otra URL, como los redirects de spotify.app.link) */
    if (/spotify/i.test(url)) {
      const spb = url.match(/playlist(?:\/|%2F)([A-Za-z0-9]{15,})/i);
      if (spb) return NextResponse.json(await importarSpotify(spb[1]));
    }

    if (/open\.spotify\.com\/(album|track|artist)/i.test(url)) {
      return NextResponse.json({ error: "Ese link es de " + (url.match(/album/i) ? "un álbum" : url.match(/track/i) ? "una canción" : "un artista") + ", no de una playlist. En Spotify: la playlist → los 3 puntitos → Compartir → Copiar link." }, { status: 400 });
    }
    if (/music\.apple\.com/i.test(url)) {
      return NextResponse.json({ error: "Apple Music no deja leer playlists sin su llave de pago. Usa el link de Spotify o Deezer de esa playlist." }, { status: 400 });
    }
    return NextResponse.json({ error: "No reconozco ese link. Manda el link de una playlist de Spotify (open.spotify.com/playlist/... o spotify.link/...) o Deezer (deezer.com/playlist/...)." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 400 });
  }
}
