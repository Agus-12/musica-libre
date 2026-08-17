import { NextRequest, NextResponse } from "next/server";

// Download full MP3 info:
// - If iTunes/Apple Music link → use aaplmusicdownloader.com
// - Otherwise → search YouTube with yt-search and return videoId for playback
// No yt-dlp needed! Client plays via YouTube IFrame API.

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return await resp.json();
}

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q") || "";
  const itunesUrl = p.get("itunes_url") || "";
  const spotifyUrl = p.get("spotify_url") || "";

  if (!query && !itunesUrl && !spotifyUrl) {
    return NextResponse.json({ error: "Falta búsqueda (q)" }, { status: 400 });
  }

  try {
    // ── Method 1: iTunes/Apple Music URL → aaplmusicdownloader.com ──
    const appleUrl = itunesUrl || "";
    if (appleUrl.includes("apple.com") || appleUrl.includes("itunes.apple.com")) {
      // Also search YouTube for a playable video
      let ytVideoId = null;
      let ytTitle = null;
      try {
        const ytSearch = await import("yt-search");
        const results = await ytSearch.default(query + " official audio");
        if (results.videos && results.videos.length > 0) {
          // Prefer "audio" or "official" videos
          let video = results.videos[0];
          for (const v of results.videos.slice(0, 5)) {
            const t = (v.title || "").toLowerCase();
            if (t.includes("audio") || t.includes("official audio") || t.includes("lyric")) {
              video = v;
              break;
            }
          }
          ytVideoId = video.videoId;
          ytTitle = video.title;
        }
      } catch {}

      return NextResponse.json({
        success: true,
        method: "aaplmusicdownloader",
        download_url: "https://aaplmusicdownloader.com/",
        apple_url: appleUrl,
        video_id: ytVideoId,
        video_title: ytTitle,
        quality: "256K M4A (original Apple) + YouTube para reproducir",
        note: "Reproducimos vía YouTube, y también podés descargar desde Apple Music",
      });
    }

    // ── Method 2: YouTube search with yt-search (works on Vercel!) ──
    let searchQuery = query;

    if (spotifyUrl && spotifyUrl.includes("spotify.com")) {
      try {
        const oembed = await fetchJSON("https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl));
        if (oembed.title) searchQuery = oembed.title;
      } catch {}
    }

    // Search YouTube
    const ytSearch = await import("yt-search");
    const results = await ytSearch.default(searchQuery + " official audio");

    if (!results.videos || results.videos.length === 0) {
      // Try without "official audio"
      const results2 = await ytSearch.default(searchQuery + " audio");
      if (!results2.videos || results2.videos.length === 0) {
        return NextResponse.json({ error: "No se encontró la canción en YouTube" }, { status: 404 });
      }
      results.videos = results2.videos;
    }

    // Pick best result
    let video = results.videos[0];
    for (const v of results.videos.slice(0, 8)) {
      const t = (v.title || "").toLowerCase();
      if (t.includes("official audio") || t.includes("audio") || t.includes("lyric")) {
        video = v;
        break;
      }
    }

    return NextResponse.json({
      success: true,
      method: "youtube",
      video_id: video.videoId,
      video_url: video.url,
      title: video.title,
      duration: video.duration?.seconds || 0,
      query: searchQuery,
      note: "Reproducir vía YouTube IFrame (canción completa)",
    });

  } catch (e) {
    return NextResponse.json({ error: "Error: " + (e.message || "desconocido") }, { status: 500 });
  }
}
