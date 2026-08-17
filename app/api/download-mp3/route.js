import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Download full MP3:
// - If iTunes/Apple Music link → use aaplmusicdownloader.com (original 256K M4A)
// - Fallback → search YouTube + yt-dlp (audio only)

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
    // Build the Apple Music link from the source_url
    const appleUrl = itunesUrl || "";
    if (appleUrl.includes("apple.com") || appleUrl.includes("itunes.apple.com")) {
      // Return info that the frontend can use to open aaplmusicdownloader
      // (Can't automate due to CAPTCHA)
      return NextResponse.json({
        success: true,
        method: "aaplmusicdownloader",
        download_url: "https://aaplmusicdownloader.com/",
        apple_url: appleUrl,
        quality: "320kbps MP3 / 256K M4A (original Apple)",
        note: "Abrí aaplmusicdownloader.com y pegá este link para descargar con la mejor calidad",
      });
    }

    // ── Method 2: YouTube search + yt-dlp (fallback) ──
    let searchQuery = query;

    if (spotifyUrl && spotifyUrl.includes("spotify.com")) {
      try {
        const oembed = await fetchJSON("https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl));
        if (oembed.title) searchQuery = oembed.title;
      } catch {}
    }

    // Search YouTube
    const ytSearch = await import("yt-search");
    const results = await ytSearch.default(searchQuery + " audio");

    if (!results.videos || results.videos.length === 0) {
      return NextResponse.json({ error: "No se encontró la canción" }, { status: 404 });
    }

    // Pick best result
    let video = results.videos[0];
    for (const v of results.videos.slice(0, 8)) {
      const t = (v.title || "").toLowerCase();
      if (t.includes("audio") || t.includes("official audio") || t.includes("lyric")) {
        video = v;
        break;
      }
    }

    // Get audio URL with yt-dlp
    const { stdout } = await execFileAsync("yt-dlp", [
      "--get-url",
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
      "--no-playlist",
      "--no-warnings",
      video.url,
    ], { timeout: 30000 });

    const audioUrl = stdout.trim().split("\n")[0];

    if (!audioUrl) {
      return NextResponse.json({ error: "No se pudo obtener el audio" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      method: "youtube",
      audio_url: audioUrl,
      video_id: video.videoId,
      title: video.title,
      duration: video.duration?.seconds || 0,
      query: searchQuery,
    });

  } catch (e) {
    return NextResponse.json({ error: "Error: " + (e.message || "desconocido") }, { status: 500 });
  }
}
