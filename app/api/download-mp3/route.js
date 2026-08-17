import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Download full MP3 from YouTube by searching song name + artist
// Uses yt-search (search) + yt-dlp (download) — no API keys needed

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
  const spotifyUrl = p.get("spotify_url") || "";
  const action = p.get("action") || "search"; // search or download

  if (!query && !spotifyUrl) {
    return NextResponse.json({ error: "Falta búsqueda (q)" }, { status: 400 });
  }

  try {
    let searchQuery = query;

    // If we have a Spotify URL, get the track title from oEmbed
    if (spotifyUrl && spotifyUrl.includes("spotify.com")) {
      try {
        const oembed = await fetchJSON("https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl));
        if (oembed.title) searchQuery = oembed.title;
      } catch {}
    }

    // Search YouTube using yt-search
    const ytSearch = await import("yt-search");
    const results = await ytSearch.default(searchQuery + " audio");

    if (!results.videos || results.videos.length === 0) {
      return NextResponse.json({ error: "No se encontró la canción en YouTube" }, { status: 404 });
    }

    // Pick best result (prefer "audio", "official", "lyric")
    let video = results.videos[0];
    for (const v of results.videos.slice(0, 8)) {
      const t = (v.title || "").toLowerCase();
      if (t.includes("audio") || t.includes("official audio") || t.includes("lyric")) {
        video = v;
        break;
      }
    }

    // If just searching, return info
    if (action === "search") {
      return NextResponse.json({
        success: true,
        video_id: video.videoId,
        title: video.title,
        duration: video.duration?.seconds || 0,
        query: searchQuery,
        url: video.url,
      });
    }

    // Download: use yt-dlp to get the direct audio URL
    const { stdout } = await execFileAsync("yt-dlp", [
      "--get-url",
      "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
      "--no-playlist",
      "--no-warnings",
      "--js-runtimes", "deno,node",
      video.url,
    ], { timeout: 30000 });

    const audioUrl = stdout.trim().split("\n")[0];

    if (!audioUrl) {
      return NextResponse.json({ error: "No se pudo obtener el audio" }, { status: 500 });
    }

    // Return the direct audio URL
    return NextResponse.json({
      success: true,
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
