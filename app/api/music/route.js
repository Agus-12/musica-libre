import { NextRequest, NextResponse } from "next/server";

// Unified music API — Deezer (primary), iTunes (fallback), oEmbed (Spotify URLs)
// ALL FREE, NO AUTH REQUIRED

const DEEZER_BASE = "https://api.deezer.com";
const ITUNES_BASE = "https://itunes.apple.com";

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const action = p.get("action") || "search";
  const query = p.get("q") || "";
  const id = p.get("id") || "";
  const source = p.get("source") || "deezer"; // deezer, itunes, oembed
  const limit = parseInt(p.get("limit") || "20");

  try {
    // ── OEMBED: get info from a Spotify URL ──
    if (action === "oembed") {
      const url = p.get("url") || "";
      if (!url) return NextResponse.json({ error: "Falta url" }, { status: 400 });
      const resp = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(url));
      if (!resp.ok) return NextResponse.json({ error: "oEmbed error " + resp.status }, { status: resp.status });
      const data = await resp.json();
      // Also try to get larger image by replacing size in URL
      let largeImage = data.thumbnail_url || "";
      if (largeImage.includes("/image/")) {
        // Spotify CDN: replace size code for larger image
        largeImage = largeImage.replace(/\/image\/\w+/, "/image/ab67616d0000b273");
      }
      return NextResponse.json({
        title: data.title || "",
        provider: data.provider_name || "",
        thumbnail: data.thumbnail_url || "",
        thumbnail_large: largeImage,
        html: data.html || "",
        width: data.thumbnail_width,
        height: data.thumbnail_height,
      });
    }

    // ── DEEZER ──
    if (source === "deezer") {
      if (action === "search") {
        if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
        const type = p.get("type") || "album,artist";
        const results = {};
        
        if (type.includes("album")) {
          const resp = await fetch(DEEZER_BASE + "/search/album?q=" + encodeURIComponent(query) + "&limit=" + limit);
          const data = await resp.json();
          results.albums = (data.data || []).map(normalizeDeezerAlbum);
        }
        if (type.includes("artist")) {
          const resp = await fetch(DEEZER_BASE + "/search/artist?q=" + encodeURIComponent(query) + "&limit=" + Math.min(limit, 10));
          const data = await resp.json();
          results.artists = (data.data || []).map(normalizeDeezerArtist);
        }
        return NextResponse.json(results);
      }

      if (action === "album") {
        if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
        const resp = await fetch(DEEZER_BASE + "/album/" + id);
        if (!resp.ok) return NextResponse.json({ error: "Deezer error " + resp.status }, { status: resp.status });
        const data = await resp.json();
        // Also get tracks
        const tracksResp = await fetch(DEEZER_BASE + "/album/" + id + "/tracks?limit=50");
        const tracksData = await tracksResp.ok ? await tracksResp.json() : { data: [] };
        return NextResponse.json(normalizeDeezerAlbumDetail(data, tracksData.data || []));
      }

      if (action === "artist") {
        if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
        const resp = await fetch(DEEZER_BASE + "/artist/" + id);
        if (!resp.ok) return NextResponse.json({ error: "Deezer error " + resp.status }, { status: resp.status });
        const data = await resp.json();
        // Get artist albums
        const albumsResp = await fetch(DEEZER_BASE + "/artist/" + id + "/albums?limit=" + limit);
        const albumsData = await albumsResp.ok ? await albumsResp.json() : { data: [] };
        return NextResponse.json(normalizeDeezerArtistDetail(data, albumsData.data || []));
      }

      if (action === "track-search") {
        if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
        const resp = await fetch(DEEZER_BASE + "/search?q=" + encodeURIComponent(query) + "&limit=" + limit);
        const data = await resp.json();
        return NextResponse.json({ tracks: (data.data || []).map(normalizeDeezerTrack) });
      }
    }

    // ── ITUNES (fallback) ──
    if (source === "itunes") {
      if (action === "search") {
        if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
        const entity = p.get("entity") || "album";
        const resp = await fetch(ITUNES_BASE + "/search?term=" + encodeURIComponent(query) + "&entity=" + entity + "&limit=" + limit);
        if (!resp.ok) return NextResponse.json({ error: "iTunes error " + resp.status }, { status: resp.status });
        const data = await resp.json();
        if (entity === "album") {
          return NextResponse.json({ albums: (data.results || []).map(normalizeITunesAlbum) });
        }
        return NextResponse.json({ results: data.results || [] });
      }

      if (action === "lookup") {
        if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
        const resp = await fetch(ITUNES_BASE + "/lookup?id=" + id + "&entity=album");
        if (!resp.ok) return NextResponse.json({ error: "iTunes error " + resp.status }, { status: resp.status });
        const data = await resp.json();
        return NextResponse.json({ results: data.results || [] });
      }
    }

    return NextResponse.json({ error: "Accion o source no valido" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Normalizers (convert to consistent format) ──

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
    })),
    source: "deezer",
    type: "album",
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
    images: [
      ...(a.picture_xl ? [{ url: a.picture_xl, size: "1000x1000", label: "XL (1000px)" }] : []),
      ...(a.picture_big ? [{ url: a.picture_big, size: "500x500", label: "Grande (500px)" }] : []),
      ...(a.picture_medium ? [{ url: a.picture_medium, size: "250x250", label: "Mediana (250px)" }] : []),
      ...(a.picture_small ? [{ url: a.picture_small, size: "75x75", label: "Chica (75px)" }] : []),
    ],
  };
}

function normalizeDeezerTrack(t) {
  return {
    id: String(t.id),
    name: t.title || "",
    artist: t.artist?.name || "",
    album: t.album?.title || "",
    album_id: t.album?.id ? String(t.album.id) : null,
    album_cover: t.album?.cover_big || t.album?.cover_medium || "",
    duration: t.duration ? formatDuration(t.duration) : "",
    duration_sec: t.duration || 0,
    preview_url: t.preview || "",
    source: "deezer",
    type: "track",
  };
}

function normalizeITunesAlbum(a) {
  // iTunes artwork: replace 100x100 with larger sizes
  const art100 = a.artworkUrl100 || "";
  const art600 = art100.replace("100x100", "600x600");
  return {
    id: a.collectionId || a.artistId || "",
    name: a.collectionName || a.artistName || "",
    artist: a.artistName || "",
    cover_medium: art100,
    cover_big: art600,
    cover_xl: art600,
    year: a.releaseDate?.split("-")[0] || "",
    track_count: a.trackCount || 0,
    genre: a.primaryGenreName || "",
    source: "itunes",
    type: "album",
  };
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
