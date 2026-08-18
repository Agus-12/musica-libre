import { NextRequest, NextResponse } from "next/server";

// Unified music API — Deezer (primary), iTunes (fallback), oEmbed (Spotify URLs)
// ALL FREE, NO AUTH REQUIRED

const DEEZER_BASE = "https://api.deezer.com";
const ITUNES_BASE = "https://itunes.apple.com";

/* Clave para detectar el MISMO tema/álbum en dos catálogos:
   minúsculas, sin paréntesis/corchetes, sin "- single/ep", sin signos. */
function claveDedupe(artista, titulo) {
  return (String(artista || "") + "|" + String(titulo || ""))
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/-\s*(single|ep)\b.*$/g, "")
    .replace(/[^a-z0-9\u00e1-\u00fa\u00f1|]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Helper: fetch JSON with error handling
async function fetchJSON(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} from ${new URL(url).hostname}: ${text.slice(0, 100)}`);
  }
  return await resp.json();
}

export async function GET(req) {
  const resp = await manejarGET(req);
  /* Cache del edge de Vercel: los resultados de iTunes/Deezer no cambian
     minuto a minuto. Con esto, el feed y las búsquedas repetidas salen
     de la CDN en milisegundos en vez de pegarle a iTunes cada vez. */
  try {
    if (resp && resp.ok && !resp.headers.get("Cache-Control")) {
      resp.headers.set(
        "Cache-Control",
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
      );
    }
  } catch {}
  return resp;
}

async function manejarGET(req) {
  const p = req.nextUrl.searchParams;
  const action = p.get("action") || "search";
  const query = p.get("q") || "";
  const id = p.get("id") || "";
  const source = p.get("source") || "itunes"; // itunes only
  const limit = parseInt(p.get("limit") || "20");

  try {
    /* ── FEED VIVO: charts y lanzamientos REALES (Deezer los
       actualiza a diario) + Latin Hits de iTunes ── */
    if (action === "feed") {
      const [chartAlb, releases, seleccion, chartTracks, latin] = await Promise.all([
        fetchJSON(DEEZER_BASE + "/chart/0/albums?limit=12").catch(() => ({ data: [] })),
        fetchJSON(DEEZER_BASE + "/editorial/0/releases?limit=12").catch(() => ({ data: [] })),
        // Respaldo: la selección curada de Deezer (releases suele venir vacío)
        fetchJSON(DEEZER_BASE + "/editorial/0/selection").catch(() => ({ data: [] })),
        fetchJSON(DEEZER_BASE + "/chart/0/tracks?limit=14").catch(() => ({ data: [] })),
        fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent("latin hits") + "&entity=album&limit=10").catch(() => ({ results: [] })),
      ]);
      const nuevosData = (releases.data || []).length ? releases.data : (seleccion.data || []);
      const resp = NextResponse.json({
        top: (chartAlb.data || []).map(normalizeDeezerAlbum),
        nuevos: nuevosData.map(normalizeDeezerAlbum).filter(a => a.id && a.name),
        momento: (chartTracks.data || []).filter(t => t.id && t.album).map(t => ({
          id: String(t.id),
          name: t.title || "",
          artist: t.artist?.name || "",
          album_id: String(t.album?.id || ""),
          cover: t.album?.cover_medium || "",
          preview_url: t.preview || "",
          duration_ms: (t.duration || 0) * 1000,
          source: "deezer",
        })),
        latin: (latin.results || []).map(normalizeITunesAlbum),
      });
      resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400");
      return resp;
    }

    /* ── SUGERENCIAS: autocompletado estilo Spotify mientras tecleás ── */
    if (action === "sugerir") {
      if (!query || query.length < 2) return NextResponse.json({ sugerencias: [] });
      /* Un solo viaje: las canciones top para lo tecleado. Los ARTISTAS
         salen de esas canciones (ordenadas por popularidad real): así
         "ari" sugiere a Ariana Grande y no a un "Ari" desconocido. */
      const trk = await fetchJSON(DEEZER_BASE + "/search?q=" + encodeURIComponent(query) + "&limit=12").catch(() => ({ data: [] }));
      const sugerencias = [];
      const artVistos = new Set();
      for (const t of (trk.data || [])) {
        const a = t.artist;
        if (!a || !a.name || artVistos.has(a.name.toLowerCase())) continue;
        artVistos.add(a.name.toLowerCase());
        sugerencias.push({ tipo: "artista", texto: a.name, cover: a.picture_medium || a.picture || "" });
        if (artVistos.size >= 3) break;
      }
      const vistas = new Set();
      for (const t of (trk.data || [])) {
        if (vistas.size >= 5) break;
        const k = claveDedupe(t.artist?.name, t.title);
        if (vistas.has(k)) continue;
        vistas.add(k);
        sugerencias.push({
          tipo: "cancion",
          texto: t.title || "",
          sub: t.artist?.name || "",
          album_id: String(t.album?.id || ""),
          cover: t.album?.cover_small || t.album?.cover_medium || "",
          source: "deezer",
        });
      }
      const resp = NextResponse.json({ sugerencias: sugerencias.slice(0, 8) });
      resp.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
      return resp;
    }

    /* ── RECOMENDACIONES: el "Para ti" vivo ─────────────────────
       Recibe los artistas que el usuario más escucha (favoritos +
       descargas) y arma recomendaciones REALES:
       1. Deezer: para cada artista semilla → artistas relacionados
          (mismo estilo/género, curado por Deezer)
       2. iTunes: álbumes recientes de esos artistas similares
       Cuanto más agregue el usuario, más cambian las semillas y
       más se mueve la sección. */
    if (action === "recomendaciones") {
      const semillas = (p.get("artistas") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
      if (!semillas.length) return NextResponse.json({ albums: [], similares: [] });

      // 1. Artistas relacionados de cada semilla (en paralelo)
      const relacionados = await Promise.all(semillas.map(async (nombre) => {
        try {
          const b = await fetchJSON(DEEZER_BASE + "/search/artist?q=" + encodeURIComponent(nombre) + "&limit=1");
          const art = (b.data || [])[0];
          if (!art) return [];
          const rel = await fetchJSON(DEEZER_BASE + "/artist/" + art.id + "/related?limit=6");
          return (rel.data || []).map(a => a.name).filter(Boolean);
        } catch { return []; }
      }));

      // 2. Ranking: los que se repiten entre semillas van primero
      const bajas = new Set(semillas.map(s => s.toLowerCase()));
      const conteo = new Map();
      for (const lista of relacionados) {
        for (const n of lista) {
          if (bajas.has(n.toLowerCase())) continue;
          conteo.set(n, (conteo.get(n) || 0) + 1);
        }
      }
      const similares = [...conteo.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 6);

      // 3. Un álbum reciente de cada artista similar (iTunes, en paralelo)
      const porArtista = await Promise.all(similares.map(async (nombre) => {
        try {
          const d = await fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(nombre) + "&entity=album&limit=2");
          return (d.results || []).slice(0, 2).map(normalizeITunesAlbum);
        } catch { return []; }
      }));

      // Intercalamos para que no salgan 2 seguidos del mismo artista
      const albums = [];
      for (let i = 0; i < 2; i++) for (const lista of porArtista) if (lista[i]) albums.push(lista[i]);

      return NextResponse.json({ albums: albums.slice(0, 12), similares, basado_en: semillas, source: "itunes" });
    }

    // ── OEMBED: get info from a Spotify URL ──
    if (action === "oembed") {
      const url = p.get("url") || "";
      if (!url) return NextResponse.json({ error: "Falta url" }, { status: 400 });
      const data = await fetchJSON("https://open.spotify.com/oembed?url=" + encodeURIComponent(url));
      // Spotify CDN image IDs are encoded and can't be simply resized by changing parts.
      // The oEmbed thumbnail is typically ~300-480px. For larger images, use Deezer/iTunes search.
      const thumb = data.thumbnail_url || "";
      let largeImage = thumb;
      return NextResponse.json({
        title: data.title || "",
        provider: data.provider_name || "",
        thumbnail: thumb,
        thumbnail_large: largeImage,
        html: data.html || "",
        width: data.thumbnail_width,
        height: data.thumbnail_height,
      });
    }

    /* iTunes es el catálogo principal; Deezer complementa (más variedad)
       y atiende los detalles de SUS álbumes. */
    let effectiveSource = source === "deezer" ? "deezer" : "itunes";

    // ── DEEZER ──
    if (effectiveSource === "deezer") {
      try {
        if (action === "search") {
          if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
          const type = p.get("type") || "album,artist";
          const results = { source: "deezer" };
          
          if (type.includes("album")) {
            const data = await fetchJSON(DEEZER_BASE + "/search/album?q=" + encodeURIComponent(query) + "&limit=" + limit);
            results.albums = (data.data || []).map(normalizeDeezerAlbum);
          }
          if (type.includes("artist")) {
            const data = await fetchJSON(DEEZER_BASE + "/search/artist?q=" + encodeURIComponent(query) + "&limit=" + Math.min(limit, 10));
            results.artists = (data.data || []).map(normalizeDeezerArtist);
          }
          return NextResponse.json(results);
        }

        if (action === "album") {
          if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
          const data = await fetchJSON(DEEZER_BASE + "/album/" + id);
          let tracks = [];
          try {
            const tracksData = await fetchJSON(DEEZER_BASE + "/album/" + id + "/tracks?limit=50");
            tracks = tracksData.data || [];
          } catch {}
          return NextResponse.json(normalizeDeezerAlbumDetail(data, tracks));
        }

        if (action === "artist") {
          if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
          const data = await fetchJSON(DEEZER_BASE + "/artist/" + id);
          let albums = [];
          try {
            const albumsData = await fetchJSON(DEEZER_BASE + "/artist/" + id + "/albums?limit=" + limit);
            albums = albumsData.data || [];
          } catch {}
          return NextResponse.json(normalizeDeezerArtistDetail(data, albums));
        }
      } catch (deezerErr) {
        // Deezer failed, try iTunes as fallback
        if (action === "search" && query) {
          try {
            const data = await fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=album&limit=" + limit);
            return NextResponse.json({ albums: (data.results || []).map(normalizeITunesAlbum), artists: [], source: "itunes" });
          } catch (itunesErr) {
            return NextResponse.json({ error: "Deezer e iTunes no responden: " + deezerErr.message }, { status: 502 });
          }
        }
        return NextResponse.json({ error: "Deezer error: " + deezerErr.message }, { status: 502 });
      }
    }

    // ── ITUNES ──
    if (effectiveSource === "itunes" || source === "itunes") {
      if (action === "search") {
        if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
        const entity = p.get("entity") || "album";
        if (entity === "album") {
          /* Álbumes + artistas EN PARALELO. Antes solo se pedían álbumes
             y la sección "Artistas" del buscador quedaba siempre vacía.
             Las fotos de artista no existen en iTunes: las tomamos de
             Deezer emparejando por nombre (si falla, sin foto y ya). */
          const [data, artistData, dzData, songData, dzAlbums, dzTracks] = await Promise.all([
            fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=album&limit=" + limit),
            fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=musicArtist&limit=6").catch(() => ({ results: [] })),
            fetchJSON(DEEZER_BASE + "/search/artist?q=" + encodeURIComponent(query) + "&limit=10").catch(() => ({ data: [] })),
            /* Canciones sueltas: sin esto, una canción cuyo nombre no
               titula su álbum era imposible de encontrar. */
            fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=song&limit=12").catch(() => ({ results: [] })),
            /* Deezer complementa: lo que iTunes no tiene, entra de acá */
            fetchJSON(DEEZER_BASE + "/search/album?q=" + encodeURIComponent(query) + "&limit=12").catch(() => ({ data: [] })),
            fetchJSON(DEEZER_BASE + "/search?q=" + encodeURIComponent(query) + "&limit=12").catch(() => ({ data: [] })),
          ]);
          const fotos = new Map();
          for (const d of (dzData.data || [])) {
            if (d.name) fotos.set(d.name.toLowerCase().trim(), d.picture_medium || d.picture || "");
          }
          const artistas = (artistData.results || []).map(a => ({
            id: String(a.artistId || ""),
            name: a.artistName || "",
            picture_medium: fotos.get((a.artistName || "").toLowerCase().trim()) || "",
            nb_album: 0,
            source: "itunes",
            type: "artist",
            source_url: a.artistLinkUrl || "",
          })).filter(a => a.id);
          /* Los que quedaron sin foto se buscan POR SU NOMBRE en Deezer
             (en paralelo). Antes solo había foto si Deezer devolvía al
             artista para el texto buscado — por eso salían con "?". */
          await Promise.all(artistas.filter(a => !a.picture_medium).slice(0, 6).map(async (a) => {
            try {
              const d = await fetchJSON(DEEZER_BASE + "/search/artist?q=" + encodeURIComponent('"' + a.name + '"') + "&limit=1");
              const hit = (d.data || [])[0];
              if (hit && hit.name) {
                const n1 = hit.name.toLowerCase().trim(), n2 = a.name.toLowerCase().trim();
                if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) {
                  a.picture_medium = hit.picture_medium || hit.picture || "";
                }
              }
            } catch {}
          }));
          /* Mezcla anti-duplicados: iTunes manda; Deezer agrega lo nuevo */
          const albumsIt = (data.results || []).map(normalizeITunesAlbum);
          const clavesAlb = new Set(albumsIt.map(a => claveDedupe(a.artist, a.name)));
          const albumsDz = (dzAlbums.data || [])
            .map(normalizeDeezerAlbum)
            .filter(a => {
              const k = claveDedupe(a.artist, a.name);
              if (clavesAlb.has(k)) return false;
              clavesAlb.add(k);
              return true;
            });

          const cancionesIt = (songData.results || []).filter(s => s.wrapperType === "track").map(s => ({
            id: String(s.trackId || ""),
            name: s.trackName || "",
            artist: s.artistName || "",
            album: s.collectionName || "",
            album_id: String(s.collectionId || ""),
            cover: (s.artworkUrl100 || "").replace("100x100", "300x300"),
            duration_ms: s.trackTimeMillis || 0,
            preview_url: s.previewUrl || "",
            source: "itunes",
          })).filter(s => s.id && s.album_id);
          const clavesCan = new Set(cancionesIt.map(s => claveDedupe(s.artist, s.name)));
          const cancionesDz = (dzTracks.data || []).filter(t => t.id && t.album).map(t => ({
            id: String(t.id),
            name: t.title || "",
            artist: t.artist?.name || "",
            album: t.album?.title || "",
            album_id: String(t.album?.id || ""),
            cover: t.album?.cover_medium || "",
            duration_ms: (t.duration || 0) * 1000,
            preview_url: t.preview || "",
            source: "deezer",
          })).filter(s => {
            if (!s.album_id) return false;
            const k = claveDedupe(s.artist, s.name);
            if (clavesCan.has(k)) return false;
            clavesCan.add(k);
            return true;
          });

          return NextResponse.json({
            albums: [...albumsIt, ...albumsDz],
            artists: artistas,
            songs: [...cancionesIt, ...cancionesDz],
            source: "itunes+deezer",
          });
        }
        const data = await fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=" + entity + "&limit=" + limit);
        // Also search artists
        const artistData = await fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=musicArtist&limit=10");
        return NextResponse.json({
          albums: (data.results || []).map(normalizeITunesAlbum),
          artists: (artistData.results || []).map(a => ({
            id: String(a.artistId || a.artistLinkUrl?.split("/").pop() || ""),
            name: a.artistName || "",
            picture_medium: "",
            nb_album: 0,
            source: "itunes",
            type: "artist",
            source_url: a.artistLinkUrl || "",
          })),
          source: "itunes",
        });
      }

      if (action === "lookup") {
        if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
        let data = await fetchJSON(ITUNES_BASE + "/lookup?id=" + id + "&entity=album,song");
        // Separate albums and songs
        let albums = (data.results || []).filter(r => r.collectionType || r.wrapperType === "collection");
        let songs = (data.results || []).filter(r => r.wrapperType === "track");
        /* iTunes a veces responde "flaco" (el álbum sin sus pistas).
           Reintentamos con entity=song, que es más confiable para las
           pistas de una colección. */
        if (albums.length > 0 && songs.length === 0) {
          try {
            const d2 = await fetchJSON(ITUNES_BASE + "/lookup?id=" + id + "&entity=song&limit=200");
            const s2 = (d2.results || []).filter(r => r.wrapperType === "track");
            if (s2.length) songs = s2;
            const a2 = (d2.results || []).filter(r => r.collectionType || r.wrapperType === "collection");
            if (!albums.length && a2.length) albums = a2;
          } catch {}
        }
        if (albums.length > 0) {
          const main = albums[0];
          const resp = NextResponse.json({
            id: String(main.collectionId),
            name: main.collectionName || "",
            artist: main.artistName || "",
            cover_medium: main.artworkUrl100 || "",
            cover_big: (main.artworkUrl100 || "").replace("100x100", "600x600"),
            cover_xl: (main.artworkUrl100 || "").replace("100x100", "600x600"),
            year: main.releaseDate?.split("-")[0] || "",
            release_date: main.releaseDate?.split("T")[0] || "",
            total_tracks: main.trackCount || songs.length,
            genre: main.primaryGenreName || "",
            tracks: songs.map((s, i) => ({
              number: s.trackNumber || i + 1,
              name: s.trackName || "",
              artist: s.artistName || main.artistName || "",
              duration: s.trackTimeMillis ? formatDurationMs(s.trackTimeMillis) : "",
              duration_ms: s.trackTimeMillis || 0,
              preview_url: s.previewUrl || "",
              source_url: s.trackViewUrl || "",
            })),
            source_url: main.collectionViewUrl || "",
            images: [
              { url: (main.artworkUrl100 || "").replace("100x100", "600x600"), size: "600x600", label: "Grande (600px)" },
              { url: main.artworkUrl100 || "", size: "100x100", label: "Chica (100px)" },
            ],
            source: "itunes",
            type: "album",
          });
          /* RESCATE: si iTunes no soltó las pistas, buscamos el MISMO
             álbum en Deezer y servimos su versión completa. */
          if (songs.length === 0) {
            try {
              /* Limpiar "- Single"/"- EP"/paréntesis: con el sufijo literal
                 Deezer no encontraba nada y el rescate fallaba. */
              const tituloLimpio = (main.collectionName || "")
                .replace(/-\s*(single|ep)\s*$/i, "")
                .replace(/\(.*?\)|\[.*?\]/g, "")
                .trim();
              const q = ((main.artistName || "") + " " + tituloLimpio).trim();
              const b = await fetchJSON(DEEZER_BASE + "/search/album?q=" + encodeURIComponent(q) + "&limit=5");
              const kIt = claveDedupe(main.artistName, main.collectionName);
              const cand = (b.data || []).find(x => claveDedupe(x.artist?.name, x.title) === kIt) || (b.data || [])[0];
              if (cand) {
                const [det, trs] = await Promise.all([
                  fetchJSON(DEEZER_BASE + "/album/" + cand.id),
                  fetchJSON(DEEZER_BASE + "/album/" + cand.id + "/tracks?limit=100").catch(() => ({ data: [] })),
                ]);
                if ((trs.data || []).length) {
                  return NextResponse.json(normalizeDeezerAlbumDetail(det, trs.data || []));
                }
              }
              // Plan B del rescate: buscarla como CANCIÓN suelta
              const tLimpio = (main.collectionName || "").replace(/-\s*(single|ep)\s*$/i, "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
              const bt = await fetchJSON(DEEZER_BASE + "/search?q=" + encodeURIComponent(((main.artistName || "") + " " + tLimpio).trim()) + "&limit=5").catch(() => ({ data: [] }));
              const pista = (bt.data || []).find(x => claveDedupe(x.artist?.name, x.title) === claveDedupe(main.artistName, tLimpio)) || (bt.data || [])[0];
              if (pista && pista.album) {
                const [det2, trs2] = await Promise.all([
                  fetchJSON(DEEZER_BASE + "/album/" + pista.album.id),
                  fetchJSON(DEEZER_BASE + "/album/" + pista.album.id + "/tracks?limit=100").catch(() => ({ data: [] })),
                ]);
                if ((trs2.data || []).length) {
                  return NextResponse.json(normalizeDeezerAlbumDetail(det2, trs2.data || []));
                }
              }
            } catch {}
            // Sin rescate posible: no cachear el vacío
            resp.headers.set("Cache-Control", "no-store");
          }
          return resp;
        }
        const respVacia = NextResponse.json({ results: data.results || [] });
        respVacia.headers.set("Cache-Control", "no-store");
        return respVacia;
      }
    }

    return NextResponse.json({ error: "Accion o source no valido" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Normalizers ──

function normalizeDeezerAlbum(a) {
  return {
    id: String(a.id),
    name: a.title || "",
    artist: a.artist?.name || "",
    artist_id: a.artist?.id ? String(a.artist.id) : null,
    cover_small: a.cover_small || "",
    cover_medium: a.cover_medium || "",
    cover_big: a.cover_big || "",
    cover_xl: a.cover_xl || "",
    year: a.release_date?.split("-")[0] || "",
    source: "deezer",
    type: "album",
    source_url: a.link || "",
  };
}

function normalizeDeezerAlbumDetail(a, tracks) {
  return {
    id: String(a.id),
    name: a.title || "",
    artist: a.artist?.name || "",
    artist_id: a.artist?.id ? String(a.artist.id) : null,
    cover_small: a.cover_small || "",
    cover_medium: a.cover_medium || "",
    cover_big: a.cover_big || "",
    cover_xl: a.cover_xl || "",
    year: a.release_date?.split("-")[0] || "",
    release_date: a.release_date || "",
    total_tracks: a.nb_tracks || tracks.length,
    label: a.label || "",
    genres: (a.genres?.data || []).map(g => g.name),
    genre: (a.genres?.data || [])[0]?.name || "",
    tracks: tracks.map((t, i) => ({
      number: i + 1,
      name: t.title || "",
      artist: t.artist?.name || a.artist?.name || "",
      duration: t.duration ? formatDuration(t.duration) : "",
      duration_sec: t.duration || 0,
      duration_ms: (t.duration || 0) * 1000,
      preview_url: t.preview || "",
      source_url: t.link || "",
    })),
    source: "deezer",
    type: "album",
    source_url: a.link || "",
    images: [
      ...(a.cover_xl ? [{ url: a.cover_xl, size: "1400x1400", label: "XL (1400px)" }] : []),
      ...(a.cover_big ? [{ url: a.cover_big, size: "500x500", label: "Grande (500px)" }] : []),
      ...(a.cover_medium ? [{ url: a.cover_medium, size: "250x250", label: "Mediana (250px)" }] : []),
      ...(a.cover_small ? [{ url: a.cover_small, size: "75x75", label: "Chica (75px)" }] : []),
    ],
  };
}

function normalizeDeezerArtist(a) {
  return {
    id: String(a.id),
    name: a.name || "",
    picture_small: a.picture_small || "",
    picture_medium: a.picture_medium || "",
    picture_big: a.picture_big || "",
    picture_xl: a.picture_xl || "",
    nb_album: a.nb_album || 0,
    source: "deezer",
    type: "artist",
    source_url: a.link || "",
  };
}

function normalizeDeezerArtistDetail(a, albums) {
  return {
    id: String(a.id),
    name: a.name || "",
    picture_small: a.picture_small || "",
    picture_medium: a.picture_medium || "",
    picture_big: a.picture_big || "",
    picture_xl: a.picture_xl || "",
    nb_album: a.nb_album || 0,
    nb_fans: a.nb_fans || 0,
    albums: albums.map(normalizeDeezerAlbum),
    source: "deezer",
    type: "artist",
    source_url: a.link || "",
    images: [
      ...(a.picture_xl ? [{ url: a.picture_xl, size: "1000x1000", label: "XL (1000px)" }] : []),
      ...(a.picture_big ? [{ url: a.picture_big, size: "500x500", label: "Grande (500px)" }] : []),
      ...(a.picture_medium ? [{ url: a.picture_medium, size: "250x250", label: "Mediana (250px)" }] : []),
      ...(a.picture_small ? [{ url: a.picture_small, size: "75x75", label: "Chica (75px)" }] : []),
    ],
  };
}

function normalizeITunesAlbum(a) {
  const art100 = a.artworkUrl100 || "";
  const art600 = art100.replace("100x100", "600x600");
  return {
    id: String(a.collectionId || a.artistId || ""),
    name: a.collectionName || a.artistName || "",
    artist: a.artistName || "",
    artist_id: a.artistId ? String(a.artistId) : null,
    cover_medium: art100,
    cover_big: art600,
    cover_xl: art600,
    year: a.releaseDate?.split("-")[0] || "",
    track_count: a.trackCount || 0,
    genre: a.primaryGenreName || "",
    source: "itunes",
    type: "album",
    source_url: a.collectionViewUrl || a.artistViewUrl || "",
  };
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function formatDurationMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
