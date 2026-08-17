import { NextRequest, NextResponse } from "next/server";

// Unified music API — Deezer (primary), iTunes (fallback), oEmbed (Spotify URLs)
// ALL FREE, NO AUTH REQUIRED

const DEEZER_BASE = "https://api.deezer.com";
const ITUNES_BASE = "https://itunes.apple.com";

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
  const p = req.nextUrl.searchParams;
  const action = p.get("action") || "search";
  const query = p.get("q") || "";
  const id = p.get("id") || "";
  const source = p.get("source") || "auto"; // auto, deezer, itunes, oembed
  const limit = parseInt(p.get("limit") || "20");

  try {
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

    // ── Determine source: iTunes primary (para aaplmusicdownloader), Deezer fallback ──
    let effectiveSource = source;
    if (source === "auto") {
      // Try iTunes first (Apple Music links work with aaplmusicdownloader.com)
      try {
        await fetchJSON(ITUNES_BASE + "/search?term=test&limit=1");
        effectiveSource = "itunes";
      } catch {
        try {
          await fetchJSON(DEEZER_BASE + "/chart?limit=1");
          effectiveSource = "deezer";
        } catch {
          effectiveSource = "itunes";
        }
      }
    }

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
        const data = await fetchJSON(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=" + entity + "&limit=" + limit);
        if (entity === "album") {
          return NextResponse.json({ albums: (data.results || []).map(normalizeITunesAlbum), artists: [], source: "itunes" });
        }
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
        const data = await fetchJSON(ITUNES_BASE + "/lookup?id=" + id + "&entity=album,song");
        // Separate albums and songs
        const albums = (data.results || []).filter(r => r.collectionType || r.wrapperType === "collection");
        const songs = (data.results || []).filter(r => r.wrapperType === "track");
        if (albums.length > 0) {
          const main = albums[0];
          return NextResponse.json({
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
        }
        return NextResponse.json({ results: data.results || [] });
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
    tracks: tracks.map((t, i) => ({
      number: i + 1,
      name: t.title || "",
      artist: t.artist?.name || a.artist?.name || "",
      duration: t.duration ? formatDuration(t.duration) : "",
      duration_sec: t.duration || 0,
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
