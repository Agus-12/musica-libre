#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Servidor de música casero — corre en tu Mac mini

   ¿Por qué existe esto? Vercel no puede bajar audio de YouTube:
   YouTube bloquea las IPs de los datacenters ("Sign in to confirm
   you're not a bot"). Tu Mac usa la IP de tu casa, que NO está
   bloqueada. Por eso acá sí funciona.

   Qué hace:
     1. /resolver  → busca la canción, la baja con yt-dlp y la guarda
     2. /audio/... → sirve el archivo CON soporte de Range (206)

   Lo del Range es clave: el iPhone pide "Range: bytes=0-1" y espera
   un 206. Si le devolvés un 200 con todo el archivo, Safari no
   reproduce (bug viejo de WebKit). Android lo tolera, iPhone no.
   ═══════════════════════════════════════════════════════════════ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const crypto = require("crypto");

/* launchd arranca los programas con un PATH pelón (/usr/bin:/bin) donde
   NO están yt-dlp ni ffmpeg (viven en /usr/local/bin o /opt/homebrew/bin).
   Sin esto, el servidor corría bien a mano pero al arrancar con
   launchctl las descargas fallaban con "yt-dlp not found". */
process.env.PATH = [process.env.PATH, "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"]
  .filter(Boolean).join(":");

// ── Configuración ──────────────────────────────────────────────
const PUERTO = Number(process.env.PORT || 8787);
const CARPETA = process.env.MUSICA_DIR || path.join(os.homedir(), "musica-libre-audio");
// Clave para que nadie más use tu Mac como servidor de descargas.
const TOKEN = process.env.MUSICA_TOKEN || "";
// Límite de disco: cuando se pasa, borra lo más viejo.
const MAX_GB = Number(process.env.MUSICA_MAX_GB || 5);
// Cookies de tu sesión de YouTube: lo más efectivo contra el check de bot.
const COOKIES = process.env.MUSICA_COOKIES || "";
// Segundos mínimos entre descargas. Bajar 20 canciones de golpe es
// justo lo que hace que YouTube te marque; espaciarlas lo evita.
const PAUSA_MS = Number(process.env.MUSICA_PAUSA_MS || 4000);
// User-Agent de un navegador real.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let fallosSeguidos = 0;
let ultimaDescarga = 0;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/* Espacia las descargas en el tiempo. Sin esto, pedir muchas canciones
   seguidas es el camino más rápido a que te bloqueen la IP. */
async function esperarTurno() {
  const desde = Date.now() - ultimaDescarga;
  if (desde < PAUSA_MS) await dormir(PAUSA_MS - desde);
  ultimaDescarga = Date.now();
}

if (!fs.existsSync(CARPETA)) fs.mkdirSync(CARPETA, { recursive: true });

const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// ── Utilidades ─────────────────────────────────────────────────

function correr(cmd, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(0, 400)));
      resolve(String(stdout).trim());
    });
  });
}

function idSeguro(texto) {
  return crypto.createHash("sha1").update(String(texto)).digest("hex").slice(0, 16);
}

// Borra lo más viejo si nos pasamos del límite de disco.
function limpiarSiHaceFalta() {
  try {
    const archivos = fs.readdirSync(CARPETA)
      .filter(f => f.endsWith(".m4a") || f.endsWith(".webm") || f.endsWith(".mp3"))
      .map(f => {
        const p = path.join(CARPETA, f);
        const s = fs.statSync(p);
        return { p, size: s.size, atime: s.atimeMs };
      });
    let total = archivos.reduce((a, b) => a + b.size, 0);
    const limite = MAX_GB * 1024 * 1024 * 1024;
    if (total <= limite) return;
    archivos.sort((a, b) => a.atime - b.atime); // más viejo primero
    for (const a of archivos) {
      if (total <= limite) break;
      try { fs.unlinkSync(a.p); total -= a.size; log("borrado por espacio:", path.basename(a.p)); } catch {}
    }
  } catch {}
}

// Busca un archivo ya bajado para ese id (cualquier extensión).
function buscarExistente(id) {
  for (const ext of [".m4a", ".webm", ".mp3", ".opus"]) {
    const p = path.join(CARPETA, id + ext);
    if (fs.existsSync(p) && fs.statSync(p).size > 10000) return p;
  }
  return null;
}

/* ── Control de calidad de archivos ──────────────────────────────
   Un m4a FRAGMENTADO (cajas "moof": pedacitos sin índice completo)
   vuelve loco a iOS: la duración cambia sola (2 min → 5 min) y la
   barrita brinca. Pasaba si ffmpeg no estaba a la mano al armar el
   archivo. Ahora: TODO archivo se revisa antes de servirse; si está
   fragmentado se repara con ffmpeg (remux, sin recomprimir) y si no
   tiene remedio se borra para que se baje de nuevo limpio. */
function esM4aFragmentado(p) {
  try {
    if (!/\.(m4a|mp4)$/i.test(p)) return false;
    return fs.readFileSync(p).includes(Buffer.from("moof"));
  } catch { return false; }
}

async function sanearArchivo(p) {
  if (!p) return null;
  if (!esM4aFragmentado(p)) return p;
  log("archivo fragmentado, reparando con ffmpeg:", path.basename(p));
  const tmp = p.replace(/\.m4a$/i, ".fix.m4a");
  try {
    await correr("ffmpeg", ["-y", "-i", p, "-c", "copy", "-movflags", "+faststart", tmp], 60000);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 10000 && !esM4aFragmentado(tmp)) {
      fs.renameSync(tmp, p);
      log("reparado:", path.basename(p));
      return p;
    }
  } catch (e) {
    log("no se pudo reparar:", String(e.message || "").slice(0, 80));
  }
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  try { fs.unlinkSync(p); log("archivo dañado BORRADO (se bajará de nuevo):", path.basename(p)); } catch {}
  return null;
}

const MIME = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".webm": "audio/webm", ".opus": "audio/ogg" };

// ── Descarga con yt-dlp ────────────────────────────────────────

/* Busca en YouTube y devuelve varios ids ordenados por conveniencia.

   Por qué varios y no uno: el primer resultado de una canción popular
   suele ser el video oficial, y esos vienen con DRM (imposibles de
   bajar). Los lyric videos, los "Audio" y los covers no. Además
   descartamos lo que dure menos de 60s (recortes) o más de 15 min
   (álbumes enteros, mixes). */
async function buscarCandidatos(query, cuantos = 5, durEsperada = 0) {
  try {
    const salida = await correr("yt-dlp", [
      "--flat-playlist",
      "--no-warnings",
      "--quiet",
      "--print", "%(id)s\t%(duration)s\t%(title)s",
      `ytsearch${cuantos}:${query}`,
    ], 45000);

    const filas = salida.split("\n")
      .map((l) => l.split("\t"))
      .filter((c) => c.length >= 2 && /^[\w-]{11}$/.test(c[0]))
      .map(([id, dur, titulo]) => ({
        id,
        dur: Number(dur) || 0,
        titulo: (titulo || "").toLowerCase(),
      }))
      .filter((c) => c.dur === 0 || (c.dur >= 60 && c.dur <= 900))
      /* Si sabemos cuánto dura la canción de verdad (iTunes), descartamos
         los videos que se alejen más del 35%: fuera mixes, versiones
         dobles (canción 2 veces = silencio al final) y extendidas. */
      .filter((c) => !durEsperada || c.dur === 0 || Math.abs(c.dur - durEsperada) <= durEsperada * 0.35);

    /* Los que se anuncian como audio o letra primero: son los que
       más chances tienen de no estar protegidos. Y entre ellos, los
       de duración más parecida a la real. */
    const bueno = /audio|lyric|letra|full song|hq/;
    const malo = /official video|video oficial|live|en vivo|remix|cover|reaction/;
    const puntos = (c) => {
      let s = (bueno.test(c.titulo) ? -2 : 0) + (malo.test(c.titulo) ? 2 : 0);
      if (durEsperada && c.dur > 0) s += (Math.abs(c.dur - durEsperada) / durEsperada) * 4;
      return s;
    };
    filas.sort((a, b) => puntos(a) - puntos(b));

    return filas.map((c) => c.id);
  } catch (e) {
    log("búsqueda falló:", String(e.message || "").slice(0, 100));
    return [];
  }
}

/* ── Búsqueda en YT MUSIC (la API interna de music.youtube.com) ──
   Es la PRINCIPAL para descargas: devuelve puras CANCIONES (nada de
   videos raros, lives ni reactions), con duración y artista de verdad.
   Si falla o no encuentra, se cae a la búsqueda clásica de YouTube. */
async function buscarYTMusicCrudo(query) {
  if (typeof fetch === "undefined") return [];   // node viejo sin fetch
  /* Timeout propio: sin esto, un fetch colgado dejaba la ruta muerta */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let r;
  try {
    r = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
      signal: ctrl.signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Origin": "https://music.youtube.com",
      "Referer": "https://music.youtube.com/",
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240701.01.00", hl: "es", gl: "MX" } },
      query,
      params: "EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D",   // filtro: canciones
    }),
    });
  } finally {
    clearTimeout(timer);
  }
  const d = await r.json();
  const items = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.musicResponsiveListItemRenderer) items.push(o.musicResponsiveListItemRenderer);
    for (const v of Object.values(o)) walk(v);
  };
  walk(d);
  return items.map((it) => {
    try {
      const vid = (it.playlistItemData && it.playlistItemData.videoId)
        || (it.overlay && it.overlay.musicItemThumbnailOverlayRenderer && it.overlay.musicItemThumbnailOverlayRenderer.content
            && it.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
            && it.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint
            && it.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint
            && it.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId);
      const cols = it.flexColumns || [];
      const runs0 = (cols[0] && cols[0].musicResponsiveListItemFlexColumnRenderer && cols[0].musicResponsiveListItemFlexColumnRenderer.text && cols[0].musicResponsiveListItemFlexColumnRenderer.text.runs) || [];
      const runs1 = (cols[1] && cols[1].musicResponsiveListItemFlexColumnRenderer && cols[1].musicResponsiveListItemFlexColumnRenderer.text && cols[1].musicResponsiveListItemFlexColumnRenderer.text.runs) || [];
      const pageTypeDe = (x) => x.navigationEndpoint && x.navigationEndpoint.browseEndpoint
        && x.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs
        && x.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig
        && x.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType;
      const title = runs0.map((x) => x.text).join("");
      const textos = runs1.map((x) => x.text);
      const durTxt = textos.length ? textos[textos.length - 1] : "";
      const m = String(durTxt).trim().match(/^(\d+):(\d{2})$/);
      const durSeg = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
      const artist = runs1.filter((x) => pageTypeDe(x) === "MUSIC_PAGE_TYPE_ARTIST").map((x) => x.text).join(", ") || (textos[0] || "");
      const album = runs1.filter((x) => pageTypeDe(x) === "MUSIC_PAGE_TYPE_ALBUM").map((x) => x.text).join("");
      const thumbs = (it.thumbnail && it.thumbnail.musicThumbnailRenderer && it.thumbnail.musicThumbnailRenderer.thumbnail && it.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) || [];
      let cover = thumbs.length ? thumbs[thumbs.length - 1].url : "";
      /* Miniatura de 120px → versión grande (carátula de verdad) */
      cover = cover.replace(/w\d+-h\d+/, "w544-h544");
      if (!vid || !title) return null;
      return { videoId: vid, title, artist, album, dur: durSeg, cover };
    } catch { return null; }
  }).filter(Boolean);
}

async function buscarYTMusic(query, durEsperada = 0) {
  try {
    const canciones = await buscarYTMusicCrudo(query);
    return canciones
      .filter((c) => c.dur === 0 || (c.dur >= 60 && c.dur <= 900))
      .filter((c) => !durEsperada || c.dur === 0 || Math.abs(c.dur - durEsperada) <= durEsperada * 0.35)
      .slice(0, 5)
      .map((c) => c.videoId);
  } catch (e) {
    log("YT Music falló:", String(e.message || "").slice(0, 80));
    return [];
  }
}

// Errores que significan "este video no sirve, probá con otro".
const VIDEO_INSERVIBLE = /DRM|members-only|premium|age.?restricted|sign in to confirm your age/i;

/* "Requested format is not available" merece trato aparte: cuando lo
   dice el cliente web (o con cookies) el video de verdad no tiene audio
   descargable. Pero cuando lo dicen android/ios/tv suele ser que ESE
   cliente no recibió formatos (PO token, SABR), y otro cliente sí puede.
   Antes esto descartaba el video sin probar ios/tv. */
const FORMATO_NO_DISPONIBLE = /requested format is not available/i;

// Errores que significan "no insistas con ningún cliente".
const NO_INSISTIR = /unavailable|private|removed|copyright|no video/i;

// Evita bajar dos veces lo mismo si llegan pedidos simultáneos.
const enProceso = new Map();

/* Cola global: UNA descarga a la vez. El log mostró dos yt-dlp corriendo
   en paralelo (dos canciones pedidas a la vez): eso duplica el tráfico
   hacia YouTube y es el disparador más rápido del 403/check de bot. */
let colaGlobal = Promise.resolve();
function enColaGlobal(fn) {
  const turno = colaGlobal.then(fn, fn);
  colaGlobal = turno.then(() => {}, () => {});
  return turno;
}

/* Fallos recientes: si una canción acaba de fallar, NO la reintentamos
   en cada poll del cliente (sería martillar a YouTube). Guardamos el
   motivo 10 minutos y lo devolvemos directo. */
const fallosRecientes = new Map();

// Cache del chequeo de yt-dlp para que /salud responda al instante.
let ytdlpCache = { ts: 0, ok: false, version: null };
let ytdlpUltimaBuena = null;   // última versión que SÍ respondió

async function obtenerAudio({ videoId, query, dur = 0 }) {
  const clave = videoId || query;
  const id = idSeguro(clave);

  const ya = await sanearArchivo(buscarExistente(id));
  if (ya) { log("cache HIT:", clave); return { archivo: ya, id }; }

  if (enProceso.has(id)) return enProceso.get(id);

  const tarea = enColaGlobal(async () => {
    const destino = path.join(CARPETA, id + ".%(ext)s");

    /* Candidatos a descargar.
       Si nos dieron un videoId, ese y nada más. Si es una búsqueda,
       pedimos varios: el primer resultado suele ser el video oficial,
       que casi siempre está protegido con DRM (los "Art Track" de
       YouTube Music). Los lyric videos y los audios sí se bajan. */
    let candidatos;
    if (videoId) {
      /* Empezamos por el id que nos pidieron. Si además vino el
         nombre de la canción, guardamos alternativas por si ese
         video tiene DRM (pasa mucho con los oficiales). */
      candidatos = [videoId];
      if (query) {
        /* YT Music primero (canciones limpias), YouTube clásico después */
        const ytm = await buscarYTMusic(query, dur);
        const extra = await buscarCandidatos(query, 5, dur);
        for (const c of [...ytm, ...extra]) if (!candidatos.includes(c)) candidatos.push(c);
      }
    } else {
      /* Búsqueda PRINCIPAL: YT Music. Plan B: la búsqueda clásica. */
      const ytm = await buscarYTMusic(query, dur);
      const clasica = await buscarCandidatos(query, 5, dur);
      candidatos = [...ytm];
      for (const c of clasica) if (!candidatos.includes(c)) candidatos.push(c);
      if (!candidatos.length) throw new Error("la búsqueda no devolvió resultados");
    }

    /* Estrategias de descarga, de menos a más invasiva.
       YouTube a veces rechaza un cliente pero acepta otro, así que
       probamos varios antes de darnos por vencidos. Las cookies (si
       las configuraste) son lo más efectivo contra el check de bot. */
    const estrategias = [];
    if (COOKIES) {
      // Con cookies arrancamos por ahí: es lo que mejor funciona.
      estrategias.push({ nombre: "cookies", args: ["--cookies", COOKIES] });
    }
    estrategias.push(
      { nombre: "web", args: [] },
      { nombre: "android", args: ["--extractor-args", "youtube:player_client=android"] },
      { nombre: "ios", args: ["--extractor-args", "youtube:player_client=ios"] },
      { nombre: "tv", args: ["--extractor-args", "youtube:player_client=tv"] },
    );

    await esperarTurno();   // no bombardeamos YouTube

    let ultimoError = null;

    /* Probamos candidato por candidato, y a cada uno todos los
       clientes. En cuanto uno baja, listo. */
    for (const vid of candidatos) {
      const url = `https://www.youtube.com/watch?v=${vid}`;
      let saltarVideo = false;

      for (const est of estrategias) {
        try {
          log(`bajando (${est.nombre}) ${vid}:`, clave);
          await correr("yt-dlp", [
            // Preferencia: m4a de un solo stream (NO DASH, que baja audio y video
            // por separado y es 2-3x mas lento). Si no hay m4a, aceptamos webm
            // o cualquier bestaudio. Filtro "abr<=160" acelerara el download
            // manteniendo calidad audible (128-160 kbps es indistinguible para
            // musica en la mayoria de los oidos y baja 3-5x mas rapido).
            "-f", "bestaudio[ext=m4a][protocol!=dash_list]*/bestaudio[ext=m4a]/bestaudio",
            "-S", "abr,ext",
            "-o", destino,
            "--no-playlist",
            "--no-warnings",
            "--quiet",
            /* SIN --no-part: con .part, una descarga a medias jamás se
               confunde con un archivo terminado, y un reintento con otro
               cliente no "reanuda" pegando bytes de otro stream (eso
               creaba archivos DOBLES con ruido blanco al final). */
            // Evita bajar versiones larguísimas (live/mashup) que dejan la
            // canción con minutos de silencio al final: preferimos las de
            // duración normal (~2–8 min).
            "--match-filter", dur > 0
              ? `duration > ${Math.max(60, Math.round(dur * 0.65))} & duration < ${Math.round(dur * 1.45)}`
              : "duration > 120 & duration < 480",
            // Un navegador real; sin esto es más fácil que nos marquen.
            "--user-agent", UA,
            // Si nos limitan la tasa, reintenta en vez de morir.
            "--retries", "3",
            "--fragment-retries", "3",
            ...est.args,
            url,
          ], 180000);

          const archivo = await sanearArchivo(buscarExistente(id));
          if (archivo) {
            log("listo:", path.basename(archivo),
                (fs.statSync(archivo).size / 1048576).toFixed(1) + " MB",
                `(${vid} via ${est.nombre})`);
            fallosSeguidos = 0;
            limpiarSiHaceFalta();
            return { archivo, id };
          }
          ultimoError = new Error("rechazado por el filtro de duración (o sin archivo)");
          saltarVideo = true;   // este video no cumple; probamos otro
          break;
        } catch (e) {
          ultimoError = e;
          const msg = String(e.message || "");
          log(`  falló (${est.nombre}):`, msg.slice(0, 120));

          /* DRM real = este video no sirve con ningún cliente.
             "Formato no disponible" solo cuenta como inservible si lo
             dice el cliente web/cookies; si lo dice android/ios/tv es
             problema de ESE cliente y seguimos probando los demás. */
          const esWeb = est.nombre === "web" || est.nombre === "cookies";
          if (VIDEO_INSERVIBLE.test(msg) || (FORMATO_NO_DISPONIBLE.test(msg) && esWeb)) {
            log(`  ${vid} no se puede bajar (DRM o sin audio), pruebo otro`);
            saltarVideo = true;
            break;
          }
          // "no disponible" con un videoId explícito: no hay plan B.
          if (NO_INSISTIR.test(msg)) { saltarVideo = true; break; }

          await dormir(1500);
        }
      }

      // Limpiamos restos parciales antes de pasar al próximo candidato.
      if (saltarVideo) {
        const resto = buscarExistente(id);
        if (resto) { try { fs.unlinkSync(resto); } catch {} }
        await dormir(1000);
      }
    }

    /* ── Plan B: SoundCloud ─────────────────────────────────────
       Si TODOS los candidatos de YouTube fallaron (bloqueo, DRM,
       lo que sea), probamos la misma búsqueda en SoundCloud, que
       no tiene el check de bots de YouTube. Mejor una copia de
       SoundCloud que ninguna. */
    if (query) {
      try {
        log("YouTube agotado; probando SoundCloud:", query);
        await correr("yt-dlp", [
          "-f", "bestaudio",
          "-o", destino,
          "--no-playlist",
          "--no-warnings",
          "--quiet",
          "--match-filter", "duration > 60 & duration < 900",
          "--user-agent", UA,
          "--retries", "2",
          `scsearch1:${query}`,
        ], 180000);
        const archivo = await sanearArchivo(buscarExistente(id));
        if (archivo) {
          log("listo (SoundCloud):", path.basename(archivo),
              (fs.statSync(archivo).size / 1048576).toFixed(1) + " MB");
          fallosSeguidos = 0;
          limpiarSiHaceFalta();
          return { archivo, id };
        }
      } catch (e) {
        log("  SoundCloud también falló:", String(e.message || "").slice(0, 100));
      }
    }

    fallosSeguidos++;
    if (fallosSeguidos >= 3 && !COOKIES) {
      log("⚠ 3 fallos seguidos. Configurá MUSICA_COOKIES: es la solución al check de bot.");
    }
    throw ultimoError || new Error("no se pudo descargar");
  });

  enProceso.set(id, tarea);
  try { return await tarea; }
  finally { enProceso.delete(id); }
}

// ── Servidor HTTP ──────────────────────────────────────────────

function cors(res, req) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

/* Sirve el archivo respetando Range. Esto es lo que hace que el
   iPhone pueda reproducir y mostrar la barra de progreso. */
function servirArchivo(req, res, archivo) {
  const stat = fs.statSync(archivo);
  const tipo = MIME[path.extname(archivo)] || "application/octet-stream";
  const rango = req.headers.range;

  const base = {
    "Content-Type": tipo,
    "Accept-Ranges": "bytes",
    /* OJO: nada de "immutable, 1 año". Si el usuario borra y re-descarga,
       el contenido de esta URL CAMBIA, y Safari resucitaba el archivo
       viejo (corrupto) desde su caché de disco. */
    "Cache-Control": "public, max-age=3600",
  };

  if (rango) {
    const m = /bytes=(\d*)-(\d*)/.exec(rango);
    let inicio = m && m[1] ? parseInt(m[1], 10) : 0;
    let fin = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(inicio) || inicio < 0) inicio = 0;
    if (isNaN(fin) || fin >= stat.size) fin = stat.size - 1;

    if (inicio > fin || inicio >= stat.size) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...base,
      "Content-Range": `bytes ${inicio}-${fin}/${stat.size}`,
      "Content-Length": fin - inicio + 1,
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(archivo, { start: inicio, end: fin }).pipe(res);
  }

  res.writeHead(200, { ...base, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(archivo).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  cors(res, req);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://localhost");
  const ruta = url.pathname;

  // Chequeo de token (si configuraste uno)
  const tokenDado = url.searchParams.get("token") ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const necesitaToken = TOKEN && ruta !== "/salud";
  if (necesitaToken && tokenDado !== TOKEN) return json(res, 401, { error: "token invalido" });

  // ── /salud: para saber si el servidor está vivo ──
  if (ruta === "/salud") {
    /* La versión de yt-dlp se cachea 10 min: ejecutar el binario en cada
       consulta tarda segundos cuando la Mac está ocupada descargando, y
       eso hacía que Vercel creyera que el servidor estaba caído. */
    /* Si el último chequeo FALLÓ, reintentamos al minuto (no en 10):
       cuando la Mac anda ocupada bajando, `yt-dlp --version` se tarda
       y el false cacheado dejaba las descargas muertas 10 minutos. */
    const vencido = Date.now() - ytdlpCache.ts > (ytdlpCache.ok ? 10 * 60 * 1000 : 60 * 1000);
    if (vencido) {
      try {
        const v = await correr("yt-dlp", ["--version"], 8000);
        ytdlpUltimaBuena = v;
        ytdlpCache = { ts: Date.now(), ok: true, version: v };
      } catch {
        /* ¿Falló el chequeo pero ANTES sí funcionaba? La Mac solo está
           ocupada: seguimos reportando la última versión buena. Solo
           decimos false si yt-dlp NUNCA ha respondido desde el arranque. */
        ytdlpCache = { ts: Date.now(), ok: Boolean(ytdlpUltimaBuena), version: ytdlpUltimaBuena };
      }
    }
    const ytdlp = ytdlpCache.ok, version = ytdlpCache.version;
    let guardadas = 0, mb = 0;
    try {
      for (const f of fs.readdirSync(CARPETA)) {
        if (/\.(m4a|webm|mp3|opus)$/.test(f)) {
          guardadas++; mb += fs.statSync(path.join(CARPETA, f)).size;
        }
      }
    } catch {}
    return json(res, 200, {
      ok: true, ytdlp, version, servidor: "2026-08-23b", carpeta: CARPETA,
      protegido: Boolean(TOKEN),
      cookies: Boolean(COOKIES),
      canciones_guardadas: guardadas,
      espacio_mb: Math.round(mb / 1048576),
      fallos_seguidos: fallosSeguidos,
    });
  }

  // ── /ytmusic: búsqueda de canciones en YT Music (para Explorar) ──
  if (ruta === "/ytmusic") {
    const q = url.searchParams.get("q") || "";
    if (!q.trim()) return json(res, 400, { error: "falta q" });
    try {
      const canciones = await buscarYTMusicCrudo(q);
      return json(res, 200, { canciones: canciones.slice(0, 20) });
    } catch (e) {
      return json(res, 500, { error: String(e.message || "").slice(0, 120) });
    }
  }

  // ── /resolver: baja la canción y devuelve dónde escucharla ──
  if (ruta === "/resolver") {
    const videoId = url.searchParams.get("v") || "";
    const query = url.searchParams.get("q") || "";
    // Duración real de la canción (iTunes), para filtrar versiones dobles.
    const dur = Math.max(0, Number(url.searchParams.get("dur")) || 0);
    if (!videoId && !query) return json(res, 400, { error: "falta v o q" });

    /* ¿Cuánto esperamos con el request abierto? Si la descarga no
       terminó en ese tiempo, respondemos 202 "descargando" y el que
       llama vuelve a preguntar en unos segundos (polling).

       Por qué: el túnel de Cloudflare mata los requests que tardan
       ~100 s en responder (502), y las funciones de Vercel tienen su
       propio límite. Tener el request abierto durante minutos era LA
       causa de que las descargas nuevas siempre fallaran. */
    const espera = Math.max(0, Math.min(Number(url.searchParams.get("espera") ?? 20), 75)) * 1000;

    const clave = videoId || query;
    const id = idSeguro(clave);

    const responderListo = (archivo) => {
      const ext = path.extname(archivo);
      const qs = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";
      return json(res, 200, {
        ok: true,
        audio_path: `/audio/${id}${ext}${qs}`,
        bytes: fs.statSync(archivo).size,
        tipo: MIME[ext] || "audio/mp4",
      });
    };

    // Ya la teníamos bajada: respuesta instantánea (revisando que el
    // archivo esté sano; si estaba fragmentado se repara o se rebaja).
    const ya = await sanearArchivo(buscarExistente(id));
    if (ya) return responderListo(ya);

    // ¿Falló hace poco? Devolvemos el motivo sin reintentar.
    // 3 minutos: suficiente para no martillar a YouTube, pero corto
    // para que "borrar y volver a descargar" no quede trabado.
    const fallo = fallosRecientes.get(id);
    if (fallo && Date.now() - fallo.ts < 3 * 60 * 1000) {
      return json(res, 502, { error: "no se pudo bajar", detalle: fallo.detalle });
    }
    fallosRecientes.delete(id);

    // Lanzamos la descarga (o nos sumamos a la que ya está en curso).
    const tarea = obtenerAudio({ videoId, query, dur });
    tarea.catch((e) => {
      fallosRecientes.set(id, { ts: Date.now(), detalle: String(e.message || e).slice(0, 300) });
    });

    const resultado = await Promise.race([
      tarea.then((r) => ({ r }), (e) => ({ e })),
      dormir(espera).then(() => null),
    ]);

    if (resultado && resultado.r) return responderListo(resultado.r.archivo);
    if (resultado && resultado.e) {
      log("ERROR resolviendo", clave, "→", resultado.e.message);
      return json(res, 502, { error: "no se pudo bajar", detalle: String(resultado.e.message || "").slice(0, 300) });
    }
    // Sigue bajando en segundo plano: 202 = "volvé a preguntar".
    log("descargando en segundo plano:", clave);
    return json(res, 202, { ok: false, estado: "descargando", id });
  }

  // ── /audio/<id>.<ext>: el archivo, con Range ──
  if (ruta.startsWith("/audio/")) {
    const nombre = path.basename(ruta); // evita ../../
    const archivo = path.join(CARPETA, nombre);
    if (!archivo.startsWith(CARPETA) || !fs.existsSync(archivo)) {
      return json(res, 404, { error: "no encontrado" });
    }
    try { return servirArchivo(req, res, archivo); }
    catch (e) { return json(res, 500, { error: e.message }); }
  }

  // ── /borrar: elimina de la Mac el audio de una canción ──
  // La app lo llama cuando el usuario saca la canción de sus descargas:
  // así la Mac no guarda copias que ya nadie quiere (ahorra espacio).
  // Es inofensivo si el archivo no existe: responde ok con lista vacía.
  if (ruta === "/borrar") {
    const videoId = url.searchParams.get("v") || "";
    const query = url.searchParams.get("q") || "";
    if (!videoId && !query) return json(res, 400, { error: "falta v o q" });
    const id = idSeguro(videoId || query);
    const borrados = [];
    for (const ext of [".m4a", ".webm", ".mp3", ".opus"]) {
      const p = path.join(CARPETA, id + ext);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          borrados.push(path.basename(p));
          log("borrado:", path.basename(p));
        } catch (e) {
          return json(res, 500, { error: e.message });
        }
      }
    }
    return json(res, 200, { ok: true, borrados });
  }

  json(res, 404, { error: "ruta desconocida" });
});

servidor.listen(PUERTO, "0.0.0.0", () => {
  console.log("");
  console.log("  AURA · servidor de audio andando");
  console.log("  ─────────────────────────────────────");
  console.log("  Puerto  : " + PUERTO);
  console.log("  Guardando en: " + CARPETA);
  console.log("  Protegido con token: " + (TOKEN ? "sí" : "NO (poné MUSICA_TOKEN)"));
  console.log("  Probá: http://localhost:" + PUERTO + "/salud");
  console.log("");
});
