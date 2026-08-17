import { NextRequest, NextResponse } from "next/server";

// Download full MP3 from YouTube (matching by song name + artist)
// No API keys needed — uses yt-search + ytdl-core

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q") || "";
  const spotifyUrl = p.get("spotify_url") || "";

  if (!query && !spotifyUrl) {
    return NextResponse.json({ error: "Falta búsqueda (q) o spotify_url" }, { status: 400 });
  }

  try {
    // If we have a Spotify URL, try to get the track info first
    let searchQuery = query;
    
    if (spotifyUrl) {
      try {
        const oembedRes = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl));
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          if (oembed.title) searchQuery = oembed.title + " audio";
        }
      } catch {}
    }

    // Search YouTube for the song
    const ytSearch = await import("yt-search");
    const results = await ytSearch.default(searchQuery + " audio");
    
    if (!results.videos || results.videos.length === 0) {
      return NextResponse.json({ error: "No se encontró la canción en YouTube" }, { status: 404 });
    }

    // Pick the first result that looks like a music video (prefer "audio" or "official")
    let video = results.videos[0];
    for (const v of results.videos.slice(0, 5)) {
      const title = (v.title || "").toLowerCase();
      if (title.includes("audio") || title.includes("official") || title.includes("lyric")) {
        video = v;
        break;
      }
    }

    // Get the audio stream URL using ytdl-core
    const ytdl = await import("@distube/ytdl-core");
    const info = await ytdl.default.getInfo(video.url);
    
    // Find the best audio-only format
    const audioFormats = ytdl.default.filterFormats(info.formats, "audioonly");
    const bestAudio = audioFormats && audioFormats.length > 0 
      ? audioFormats.reduce((best, f) => (f.audioBitrate || 0) > (best.audioBitrate || 0) ? f : best, audioFormats[0])
      : null;

    if (!bestAudio || !bestAudio.url) {
      return NextResponse.json({ error: "No se pudo obtener el audio" }, { status: 500 });
    }

    // Return the audio URL so the client can download and cache it
    return NextResponse.json({
      success: true,
      audio_url: bestAudio.url,
      video_id: video.videoId,
      title: video.title,
      duration: video.duration?.seconds || 0,
      query: searchQuery,
      quality: bestAudio.audioBitrate + "kbps",
    });

  } catch (e) {
    return NextResponse.json({ error: "Error: " + (e.message || "desconocido") }, { status: 500 });
  }
}
