import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/* ═══════════════════════════════════════════════════════════════
   /api/download-mp3

   Devuelve cómo reproducir una canción. Intenta, en este orden:

   1. yt-dlp  → audio_url (archivo real, se puede cachear y oír OFFLINE)
   2. YouTube IFrame → video_id (streaming, NECESITA internet)

   El paso 1 sólo funciona si:
     · yt-dlp está instalado en el servidor  (Vercel NO lo permite), y
     · YouTube no bloquea la IP del servidor (bloquea las de datacenter).

   Por eso NUNCA damos por hecho que funciona: si falla, caemos al
   iframe de siempre y la app sigue andando igual que hasta ahora.
   ═══════════════════════════════════════════════════════════════ */

// Cache del chequeo para no pagar el costo en cada request
let ytdlpDisponible = null;

async function tieneYtDlp() {
  if (ytdlpDisponible !== null) return ytdlpDisponible;
  // En Vercel ni lo intentamos: no hay binarios en serverless.
  if (process.env.VERCEL || process.env.NEXT_RUNTIME === "edge") {
    ytdlpDisponible = false;
    return false;
  }
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 5000 });
    ytdlpDisponible = true;
  } catch {
    ytdlpDisponible = false;
  }
  return ytdlpDisponible;
}

/**
 * Intenta obtener la URL directa del audio.
 * Devuelve null si no se puede (y entonces usamos el iframe).
 */
async function obtenerAudioUrl(videoUrl) {
  if (!(await tieneYtDlp())) return null;
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      [
        "--get-url",
        "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        videoUrl,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 }
    );
    const url = (stdout || "").trim().split("\n")[0];
    return url && url.startsWith("http") ? url : null;
  } catch {
    // YouTube bloquea IPs de servidor ("Sign in to confirm you're not a bot"),
    // o yt-dlp falló. No es un error fatal: seguimos con el iframe.
    return null;
  }
}

/* ── Servidor casero (tu Mac mini) ──────────────────────────────
   Vercel no puede bajar de YouTube porque bloquea las IPs de
   datacenter. Tu Mac usa la IP de tu casa, que no está bloqueada.
   Si configuraste MUSICA_SERVER, le preguntamos a ella primero.

   Devuelve una URL absoluta al archivo, que el navegador puede
   cachear y reproducir offline (el servidor casero responde
   Range/206, que es lo que el iPhone necesita).            */
async function pedirAlServidorCasero({ videoId, query }) {
  const base = (process.env.MUSICA_SERVER || "").replace(/\/+$/, "");
  if (!base) return null;

  const token = process.env.MUSICA_TOKEN || "";
  const p = new URLSearchParams();
  if (videoId) p.set("v", videoId); else p.set("q", query || "");
  if (token) p.set("token", token);

  try {
    const resp = await fetch(`${base}/resolver?${p}`, {
      // Bajar y convertir puede tardar; damos margen pero no infinito.
      signal: AbortSignal.timeout(120000),
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok || !data.audio_path) return null;
    return { url: base + data.audio_path, bytes: data.bytes || 0 };
  } catch {
    // La Mac está apagada, sin internet o tardó demasiado.
    // No es fatal: seguimos con el iframe de YouTube.
    return null;
  }
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return await resp.json();
}

async function buscarEnYouTube(searchQuery) {
  const ytSearch = await import("yt-search");
  let results = await ytSearch.default(searchQuery + " official audio");
  if (!results.videos || results.videos.length === 0) {
    results = await ytSearch.default(searchQuery + " audio");
  }
  if (!results.videos || results.videos.length === 0) return null;

  let video = results.videos[0];
  for (const v of results.videos.slice(0, 8)) {
    const t = (v.title || "").toLowerCase();
    if (t.includes("official audio") || t.includes("audio") || t.includes("lyric")) {
      video = v;
      break;
    }
  }
  return video;
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
    // ── Apple Music / iTunes ──
    const appleUrl = itunesUrl || "";
    if (appleUrl.includes("apple.com") || appleUrl.includes("itunes.apple.com")) {
      const video = await buscarEnYouTube(query).catch(() => null);
      let audioUrl = null;
      if (video) audioUrl = await obtenerAudioUrl(video.url);

      return NextResponse.json({
        success: true,
        method: "aaplmusicdownloader",
        download_url: "https://aaplmusicdownloader.com/",
        apple_url: appleUrl,
        video_id: video?.videoId || null,
        video_title: video?.title || null,
        audio_url: audioUrl,                 // null si no se pudo
        offline: Boolean(audioUrl),          // ¿se puede guardar de verdad?
        quality: "256K M4A (original Apple) + YouTube para reproducir",
        note: audioUrl
          ? "Audio descargable: se puede guardar para escuchar sin internet"
          : "Reproducimos vía YouTube (necesita internet)",
      });
    }

    // ── Búsqueda normal ──
    let searchQuery = query;
    if (spotifyUrl && spotifyUrl.includes("spotify.com")) {
      try {
        const oembed = await fetchJSON(
          "https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl)
        );
        if (oembed.title) searchQuery = oembed.title;
      } catch {}
    }

    const video = await buscarEnYouTube(searchQuery);
    if (!video) {
      return NextResponse.json(
        { error: "No se encontró la canción en YouTube" },
        { status: 404 }
      );
    }

    /* Buscamos audio descargable en este orden:
       1. Tu Mac mini (IP de casa, YouTube no la bloquea)  ← lo normal
       2. yt-dlp local (sólo si corrés la app en tu compu)
       3. Nada → el iframe de YouTube de siempre
       Cualquier falla cae al siguiente sin romper la app. */
    let audioUrl = null;
    let fuente = null;

    const casero = await pedirAlServidorCasero({ videoId: video.videoId, query: searchQuery });
    if (casero) { audioUrl = casero.url; fuente = "casa"; }

    if (!audioUrl) {
      audioUrl = await obtenerAudioUrl(video.url);
      if (audioUrl) fuente = "local";
    }

    return NextResponse.json({
      success: true,
      method: audioUrl ? "audio" : "youtube",
      audio_url: audioUrl,                 // null → la app usa el iframe
      offline: Boolean(audioUrl),
      fuente,                              // "casa" | "local" | null
      video_id: video.videoId,
      video_url: video.url,
      title: video.title,
      duration: video.duration?.seconds || 0,
      query: searchQuery,
      note: audioUrl
        ? "Audio directo: se puede guardar para escuchar sin internet"
        : "Reproducir vía YouTube IFrame (necesita internet)",
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Error: " + (e.message || "desconocido") },
      { status: 500 }
    );
  }
}
