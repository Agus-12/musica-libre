import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/utils/supabase/server";
import { execFile } from "child_process";
import { baseMac } from "@/app/utils/servidorCasa";
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
// Último motivo por el que falló el servidor casero, para diagnóstico.
let ultimoMotivoCasa = null;

/* Chequeo rápido de vida ANTES de pedir la descarga.
   Sin esto, si la Mac está caída (o la URL del túnel es vieja) el
   request de /resolver se queda esperando hasta 120 segundos y la app
   parece colgada. /salud responde al instante: si en 5 segundos no
   contesta bien, asumimos que la Mac no está y seguimos con YouTube. */
async function servidorCaseroVivo(base) {
  try {
    const resp = await fetch(`${base}/salud`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) {
      ultimoMotivoCasa = resp.status === 502 || resp.status === 503
        ? `${resp.status}: el túnel responde pero el servidor de la Mac no está corriendo (¿servidor.js apagado, o la URL de trycloudflare es de un túnel viejo?)`
        : `salud respondió ${resp.status}`;
      return false;
    }
    const data = await resp.json().catch(() => null);
    if (!data || data.ok !== true) {
      ultimoMotivoCasa = "salud no devolvió ok:true";
      return false;
    }
    /* OJO: ytdlp:false ya NO descarta a la Mac. Cuando está ocupada
       descargando, su chequeo de yt-dlp se tardaba y reportaba false
       por 10 minutos → Vercel la ignoraba → todo caía a "YT" sin
       archivo. Aunque yt-dlp de verdad faltara, la Mac igual sirve
       las canciones YA guardadas de su caché. */
    if (data.ytdlp === false) {
      ultimoMotivoCasa = "aviso: la Mac reporta yt-dlp caído (o está muy ocupada); se intenta igual";
    }
    return true;
  } catch (e) {
    ultimoMotivoCasa =
      "la Mac no responde (túnel caído o URL vieja): " + String(e.message || e).slice(0, 60);
    return false;
  }
}

async function pedirAlServidorCasero({ videoId, query, dur }) {
  /* URL dinámica: si el túnel se reinició, la Mac ya publicó la nueva */
  const base = await baseMac();
  if (!base) { ultimoMotivoCasa = "MUSICA_SERVER vacía"; return null; }

  // Fail-fast: si la Mac no está viva, no esperamos 120 s al pedo.
  if (!(await servidorCaseroVivo(base))) return null;

  const token = process.env.MUSICA_TOKEN || "";
  const p = new URLSearchParams();
  // Mandamos los dos: el id es lo que queremos, y el texto le sirve al
  // servidor para buscar otra versión si ese video tiene DRM.
  if (videoId) p.set("v", videoId);
  if (query) p.set("q", query);
  /* La duración real de la canción (iTunes): la Mac la usa para NO bajar
     videos del doble de largo (canción repetida, mixes) que dejaban
     minutos de silencio al final. */
  if (dur && dur > 0) p.set("dur", String(Math.round(dur)));
  if (!videoId && !query) return null;
  if (token) p.set("token", token);
  // La Mac espera como mucho 20 s con el request abierto; si la descarga
  // sigue, responde 202 y el cliente vuelve a preguntar (polling).
  p.set("espera", "20");

  try {
    const resp = await fetch(`${base}/resolver?${p}`, {
      // 20 s de espera de la Mac + margen. Nunca minutos: los túneles
      // matan los requests largos y eso daba 502 en toda descarga nueva.
      signal: AbortSignal.timeout(35000),
      headers: { Accept: "application/json" },
    });
    if (resp.status === 202) {
      // La Mac sigue bajando la canción en segundo plano.
      ultimoMotivoCasa = "la Mac todavía está bajando la canción";
      return { pendiente: true };
    }
    if (!resp.ok) {
      /* La Mac manda el motivo real del fallo en el JSON (p. ej. el
         error de yt-dlp). Lo propagamos para poder diagnosticar desde
         la app sin tener que mirar el log de la Mac. */
      let detalle = "";
      try {
        const j = await resp.json();
        detalle = String(j.detalle || j.error || "").slice(0, 160);
      } catch {}
      ultimoMotivoCasa = resp.status === 401
        ? "401: el token no coincide con el de la Mac"
        : `el servidor respondió ${resp.status}` + (detalle ? ` — ${detalle}` : "");
      return null;
    }
    const data = await resp.json();
    if (!data.ok || !data.audio_path) {
      ultimoMotivoCasa = "no pudo bajar: " + String(data.detalle || data.error || "?").slice(0, 80);
      return null;
    }
    ultimoMotivoCasa = null;
    return { url: base + data.audio_path, bytes: data.bytes || 0 };
  } catch (e) {
    // La Mac está apagada, sin internet o tardó demasiado.
    // No es fatal: seguimos con el iframe de YouTube.
    ultimoMotivoCasa = "no se pudo conectar: " + String(e.message || e).slice(0, 80);
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

async function buscarEnYouTube(searchQuery, expectedDuration, expectedArtist, expectedSong) {
  const ytSearch = await import("yt-search");
  let results = await ytSearch.default(searchQuery + " official audio");
  if (!results.videos || results.videos.length === 0) {
    results = await ytSearch.default(searchQuery + " audio");
  }
  if (!results.videos || results.videos.length === 0) return null;

  const toSec = (d) => {
    if (d == null) return 9999;
    if (typeof d === "number") return d;
    const m = String(d).split(":");
    if (m.length === 2) return (Number(m[0]) || 0) * 60 + (Number(m[1]) || 0);
    if (m.length === 3) return (Number(m[0]) || 0) * 3600 + (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0);
    return 9999;
  };

  const tituloParece = (v, re) => new RegExp(re, "i").test((v.title || "").replace(/\uFFFD/g, ""));
  const esMashup = (v) =>
    tituloParece(v, "live|remix|mashup|cover|reaction|chapter|preview|trailer|shorts") ||
    tituloParece(v, "1 ?h|hour|8 horas|extended|intro|trailer|preview|feat|ft\.|featuring");
  const esTema = (v) => tituloParece(v, "oficial|official|audio|lyric|letra");

  const META = 8000;
  const scored = (results.videos || []).slice(0, 12).map((v) => {
    const dur = toSec(v.duration);
    const mashup = esMashup(v);
    const tema = esTema(v);

    let s = 0;
    // 1) Descartar todo lo que parezca mashup / live / cover / reaction.
    if (mashup) s += META;
    // 2) Si no parece un tema oficial/audio, tambien descartamos.
    else if (!tema) s += META / 2;

    // 3) Duracion esperada (de iTunes): si la tenemos, priorizamos videos
    //    cuya duracion real sea similar a la del preview original.
    if (expectedDuration && expectedDuration > 0) {
      const diff = Math.abs(dur - expectedDuration);
      // Si se va mas del 30% del target, descartamos (mashup de 7 min vs 3 min).
      if (diff > expectedDuration * 0.3) s += 4000;
      // Si esta dentro del 10% del target, lo premiamos fuerte.
      else if (diff < expectedDuration * 0.1) s -= 1500;
      // Si dura igualitos, bonus extra.
      else if (diff < expectedDuration * 0.04) s -= 3000;
    }

    // 4) Entre los NO-descartados: preferimos los mas largos (porque una
    //    cancion de 3:22 suele estar completa; una de 2:30 puede ser preview).
    if (tema) s -= Math.max(0, dur) / 12;

    // 5) HARD REQUIREMENT del titulo: si nos pasaron el titulo esperado
    //    (de iTunes), el video TIENE que contener 2 palabras significativas
    //    del mismo, si no -> descartado con META. Esto resuelve DEFINITIVAMENTE
    //    el bug de "descarga una cancion que ni es": yt-search puede devolver
    //    otra cancion del mismo artista con titulo parecido, pero si no matchea
    //    palabras del titulo esperado, no es la cancion que queremos.
    if (expectedSong) {
      const tlow = (v.title || "").toLowerCase();
      const slow = expectedSong.toLowerCase();
      const palabras = slow.split(/\s+/).filter(p => p.length > 3 && !["que", "con", "para", "por", "los", "las", "una", "del", "the"].includes(p));
      let hits = 0;
      for (const p of palabras) if (tlow.includes(p)) hits++;
      /* Necesitamos la mitad de las palabras significativas (mínimo 2),
         PERO nunca más palabras de las que el título tiene: "kiss me"
         solo aporta una ("kiss") y el mínimo fijo de 2 hacía que NINGÚN
         video pasara el filtro → "No se encontró la canción" siempre. */
      const requerido = Math.min(palabras.length, Math.max(2, Math.ceil(palabras.length / 2)));
      if (palabras.length > 0 && hits < requerido) {
        s += META; // descartado: no matchea el titulo
      }
    }

    // 6) Bonus enorme si el canal del video coincide con el artista (de iTunes).
    //    Esto refuerza que sea el canal OFICIAL del artista, no un tribute.
    if (expectedArtist && v.channel && v.channel.name) {
      const ch = (v.channel.name || "").toLowerCase();
      const art = expectedArtist.toLowerCase();
      if (ch.includes(art) || art.includes(ch) ||
          ch.split(/[\s\-|]/).some(w => w && w.length > 2 && art.includes(w)) ||
          art.split(/\s+/).some(w => w.length > 2 && ch.includes(w))) {
        s -= 3000;
      }
    }

    return { v, score: s };
  });
  scored.sort((a, b) => a.score - b.score);
  const META_DESCARTE = 8000;
  // SOLO devolvemos un candidato si su score esta por debajo del
  // umbral de descarte. Si todos tienen score >= META_DESCARTE,
  // significa que el filtro de titulo/artista descarto TODAS las opciones
  // -> devolvemos null. Asi la app no descarga "Si lo ven" en vez de
  // "Si Antes Me Hubieras Preguntado".
  if (scored.length === 0) return null;
  const mejor = scored[0];
  if (mejor.score >= META_DESCARTE) {
    console.log("todos descartados por filtro:",
        scored.length,
        "videos; mejor score=",
        mejor.score);
    return null;
  }
  return mejor.v;
}




export async function GET(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión para descargar música" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const trackKey = String(p.get("track_key") || p.get("q") || "").slice(0, 300);
  const { data: sub } = await supabase.from("suscripciones").select("plan,estado,vence_en,acceso_libre,aura_libre").eq("user_id", user.id).maybeSingle();
  const premium = Boolean(sub?.plan === "premium" && sub?.estado === "active" && (!sub?.vence_en || new Date(sub.vence_en) > new Date()));
  const ilimitado = premium || Boolean(sub?.acceso_libre || sub?.aura_libre);
  if (!ilimitado) {
    const { count } = await supabase.from("descargas_offline").select("track_key", { count: "exact", head: true }).eq("user_id", user.id);
    const { data: ya } = await supabase.from("descargas_offline").select("track_key").eq("user_id", user.id).eq("track_key", trackKey).maybeSingle();
    if (!ya && (count || 0) >= 50) return NextResponse.json({ error: "Has alcanzado el límite gratuito de 50 canciones offline. Actualiza a AURA Premium." }, { status: 403 });
  }
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
      const video = await buscarEnYouTube(query, null, null, null).catch(() => null);

      /* Mismo orden que en la búsqueda normal: primero la Mac de casa,
         que es la única que puede dar un archivo cacheable. Antes esta
         rama se saltaba el servidor casero y por eso las canciones que
         venían de Apple Music nunca quedaban disponibles sin internet. */
      let audioUrl = null;
      let fuente = null;

      const casero = await pedirAlServidorCasero({
        videoId: video?.videoId,
        query,
      });
      const pendiente = Boolean(casero && casero.pendiente);
      if (casero && casero.url) { audioUrl = casero.url; fuente = "casa"; }

      if (!audioUrl && video) {
        audioUrl = await obtenerAudioUrl(video.url);
        if (audioUrl) fuente = "local";
      }

      return NextResponse.json({
        success: true,
        method: "aaplmusicdownloader",
        download_url: "https://aaplmusicdownloader.com/",
        apple_url: appleUrl,
        video_id: video?.videoId || null,
        video_title: video?.title || null,
        audio_url: audioUrl,                 // null si no se pudo
        offline: Boolean(audioUrl),          // ¿se puede guardar de verdad?
        pendiente,                           // true = la Mac sigue bajando; reintentá
        fuente,                              // "casa" | "local" | null
        config: {
          servidor: process.env.MUSICA_SERVER ? "configurado" : "FALTA",
          token: process.env.MUSICA_TOKEN ? "configurado" : "FALTA",
          motivo: fuente === "casa" ? null : ultimoMotivoCasa,
        },
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

    const video = p.get("v") && /^[\w-]{11}$/.test(p.get("v"))
      ? /* Reintento de polling: el cliente ya sabe qué video es, no hace
           falta volver a buscar en YouTube (ahorra ~10 s por reintento). */
        {
          videoId: p.get("v"),
          url: "https://youtube.com/watch?v=" + p.get("v"),
          title: searchQuery,
          duration: null,
        }
      : await buscarEnYouTube(
          searchQuery,
          p.get("expected_duration") ? Number(p.get("expected_duration")) : null,
          p.get("expected_artist") || null,
          p.get("expected_song") || null
        ).catch(() => null);
        /* ↑ Si yt-search truena (YouTube bloquea las IPs de Vercel cada
           tanto), NO tiramos error: seguimos con video=null y la Mac
           busca por su cuenta (su IP de casa no está bloqueada). */
    if (!video) {
      /* La búsqueda estricta no encontró nada en YouTube. NO nos rendimos
         todavía: la Mac busca por su cuenta (YouTube con sus propios
         criterios y, si falla, SoundCloud). Canciones de artistas chicos
         solo aparecen por este camino. */
      const casero = await pedirAlServidorCasero({
        query: searchQuery,
        dur: p.get("expected_duration") ? Number(p.get("expected_duration")) : 0,
      });
      if (casero && casero.url) {
        return NextResponse.json({
          success: true,
          method: "audio",
          audio_url: casero.url,
          offline: true,
          pendiente: false,
          fuente: "casa",
          video_id: null,
          title: searchQuery,
          query: searchQuery,
          note: "Conseguida por la Mac (búsqueda propia / SoundCloud)",
        });
      }
      if (casero && casero.pendiente) {
        return NextResponse.json({
          success: true,
          method: "youtube",
          audio_url: null,
          offline: false,
          pendiente: true,
          fuente: null,
          video_id: null,
          title: searchQuery,
          query: searchQuery,
          note: "La Mac la está buscando (YouTube propio + SoundCloud)",
        });
      }
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

    const casero = await pedirAlServidorCasero({
      videoId: video.videoId,
      query: searchQuery,
      dur: p.get("expected_duration") ? Number(p.get("expected_duration")) : 0,
    });
    const pendiente = Boolean(casero && casero.pendiente);
    if (casero && casero.url) { audioUrl = casero.url; fuente = "casa"; }

    if (!audioUrl) {
      audioUrl = await obtenerAudioUrl(video.url);
      if (audioUrl) fuente = "local";
    }

    return NextResponse.json({
      success: true,
      method: audioUrl ? "audio" : "youtube",
      audio_url: audioUrl,                 // null → la app usa el iframe
      offline: Boolean(audioUrl),
      pendiente,                           // true = la Mac sigue bajando; reintentá
      fuente,                              // "casa" | "local" | null
      video_id: video.videoId,
      video_url: video.url,
      title: video.title,
      duration: video.duration?.seconds || 0,
      query: searchQuery,
      /* Diagnóstico: si fuente es null, esto dice por qué. No expone
         el token ni la URL, sólo si el deploy los tiene configurados. */
      config: {
        servidor: process.env.MUSICA_SERVER ? "configurado" : "FALTA",
        token: process.env.MUSICA_TOKEN ? "configurado" : "FALTA",
        motivo: fuente === "casa" ? null : ultimoMotivoCasa,
      },
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
