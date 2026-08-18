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

const MIME = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".webm": "audio/webm", ".opus": "audio/ogg" };

// ── Descarga con yt-dlp ────────────────────────────────────────

/* Busca en YouTube y devuelve varios ids ordenados por conveniencia.

   Por qué varios y no uno: el primer resultado de una canción popular
   suele ser el video oficial, y esos vienen con DRM (imposibles de
   bajar). Los lyric videos, los "Audio" y los covers no. Además
   descartamos lo que dure menos de 60s (recortes) o más de 15 min
   (álbumes enteros, mixes). */
async function buscarCandidatos(query, cuantos = 5) {
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
      .filter((c) => c.dur === 0 || (c.dur >= 60 && c.dur <= 900));

    /* Los que se anuncian como audio o letra primero: son los que
       más chances tienen de no estar protegidos. */
    const bueno = /audio|lyric|letra|full song|hq/;
    const malo = /official video|video oficial|live|en vivo|remix|cover|reaction/;
    filas.sort((a, b) => {
      const pa = (bueno.test(a.titulo) ? -2 : 0) + (malo.test(a.titulo) ? 2 : 0);
      const pb = (bueno.test(b.titulo) ? -2 : 0) + (malo.test(b.titulo) ? 2 : 0);
      return pa - pb;
    });

    return filas.map((c) => c.id);
  } catch (e) {
    log("búsqueda falló:", String(e.message || "").slice(0, 100));
    return [];
  }
}

// Errores que significan "este video no sirve, probá con otro".
const VIDEO_INSERVIBLE = /DRM|requested format is not available|members-only|premium|age.?restricted|sign in to confirm your age/i;

// Errores que significan "no insistas con ningún cliente".
const NO_INSISTIR = /unavailable|private|removed|copyright|no video/i;

// Evita bajar dos veces lo mismo si llegan pedidos simultáneos.
const enProceso = new Map();

async function obtenerAudio({ videoId, query }) {
  const clave = videoId || query;
  const id = idSeguro(clave);

  const ya = buscarExistente(id);
  if (ya) { log("cache HIT:", clave); return { archivo: ya, id }; }

  if (enProceso.has(id)) return enProceso.get(id);

  const tarea = (async () => {
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
        const extra = await buscarCandidatos(query);
        for (const c of extra) if (c !== videoId) candidatos.push(c);
      }
    } else {
      candidatos = await buscarCandidatos(query);
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
            "--no-part",
            // Evita bajar versiones larguísimas (live/mashup) que dejan la
            // canción con minutos de silencio al final: preferimos las de
            // duración normal (~2–8 min).
            "--match-filter", "duration > 120 & duration < 480",
            // Un navegador real; sin esto es más fácil que nos marquen.
            "--user-agent", UA,
            // Si nos limitan la tasa, reintenta en vez de morir.
            "--retries", "3",
            "--fragment-retries", "3",
            ...est.args,
            url,
          ], 180000);

          const archivo = buscarExistente(id);
          if (archivo) {
            log("listo:", path.basename(archivo),
                (fs.statSync(archivo).size / 1048576).toFixed(1) + " MB",
                `(${vid} via ${est.nombre})`);
            fallosSeguidos = 0;
            limpiarSiHaceFalta();
            return { archivo, id };
          }
          ultimoError = new Error("yt-dlp no dejó ningún archivo");
        } catch (e) {
          ultimoError = e;
          const msg = String(e.message || "");
          log(`  falló (${est.nombre}):`, msg.slice(0, 120));

          /* DRM o formato inexistente = este video no sirve con ningún
             cliente. Pasamos al siguiente candidato en vez de gastar
             tres intentos más en el mismo. */
          if (VIDEO_INSERVIBLE.test(msg)) {
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

    fallosSeguidos++;
    if (fallosSeguidos >= 3 && !COOKIES) {
      log("⚠ 3 fallos seguidos. Configurá MUSICA_COOKIES: es la solución al check de bot.");
    }
    throw ultimoError || new Error("no se pudo descargar");
  })();

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
    // Se puede cachear fuerte: el contenido de esa URL nunca cambia.
    "Cache-Control": "public, max-age=31536000, immutable",
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
    let ytdlp = false, version = null;
    try { version = await correr("yt-dlp", ["--version"], 5000); ytdlp = true; } catch {}
    let guardadas = 0, mb = 0;
    try {
      for (const f of fs.readdirSync(CARPETA)) {
        if (/\.(m4a|webm|mp3|opus)$/.test(f)) {
          guardadas++; mb += fs.statSync(path.join(CARPETA, f)).size;
        }
      }
    } catch {}
    return json(res, 200, {
      ok: true, ytdlp, version, carpeta: CARPETA,
      protegido: Boolean(TOKEN),
      cookies: Boolean(COOKIES),
      canciones_guardadas: guardadas,
      espacio_mb: Math.round(mb / 1048576),
      fallos_seguidos: fallosSeguidos,
    });
  }

  // ── /resolver: baja la canción y devuelve dónde escucharla ──
  if (ruta === "/resolver") {
    const videoId = url.searchParams.get("v") || "";
    const query = url.searchParams.get("q") || "";
    if (!videoId && !query) return json(res, 400, { error: "falta v o q" });

    try {
      const { archivo, id } = await obtenerAudio({ videoId, query });
      const ext = path.extname(archivo);
      const qs = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";
      return json(res, 200, {
        ok: true,
        audio_path: `/audio/${id}${ext}${qs}`,
        bytes: fs.statSync(archivo).size,
        tipo: MIME[ext] || "audio/mp4",
      });
    } catch (e) {
      log("ERROR resolviendo", videoId || query, "→", e.message);
      return json(res, 502, { error: "no se pudo bajar", detalle: e.message.slice(0, 300) });
    }
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
