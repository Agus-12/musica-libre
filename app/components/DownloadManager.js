"use client";
import { useEffect, useState, useRef, createContext, useContext, useCallback } from "react";

const STORAGE_KEY = "aura_dl_queue_v1";

/* Cola de descargas en segundo plano.
   - Las canciones se encolan en localStorage, así sobreviven a recargas.
   - Se procesan en serie (una a la vez) para no saturar la Mac.
   - Cada track completa dispara una notificación del navegador.
   - El spotify/page.js llama a enqueueAlbum(...) cuando el usuario favorita
     un álbum; la cola corre aunque el usuario navegue a /profile. */

const DownloadContext = createContext(null);

async function ensureNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

function notifyBrowser(title, body, icon) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: icon || "/icon-192.png", badge: "/icon-192.png" }); } catch {}
}

export function DownloadProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [running, setRunning] = useState(false);
  const activeRef = useRef(null);

  // Hidratamos desde localStorage una vez al montar: las descargas pendientes
  // se reanudan solas, aunque el usuario recargue la página.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          /* Si la app se cerró a mitad de una descarga, el item quedaba en
             "downloading" para siempre y el procesador solo toma "pending":
             la canción desaparecía de la cola sin bajarse. Lo devolvemos
             a pending para que se reanude solo. Las reparaciones que
             fallaron también se reintentan en cada apertura. */
          setQueue(saved
            .filter(t => t.status !== "done")
            .map(t => (t.status === "downloading" || (t.repair && t.status === "failed"))
              ? { ...t, status: "pending" } : t));
        }
      }
    } catch {}
    ensureNotificationPermission();
  }, []);

  /* ── AUTO-REPARACIÓN ────────────────────────────────────────────
     El talón de Aquiles era este: si la Mac tardaba más que la espera
     de la app, la canción quedaba guardada como "YouTube" PARA SIEMPRE,
     aunque la Mac terminara de bajarla 30 segundos después.
     Ahora, al abrir la app (y cada 5 minutos), buscamos las canciones
     sin archivo y las reencolamos. Como la Mac casi siempre ya las
     tiene, el primer pedido responde al instante y pasan a OFF. */
  const autoRepair = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let candidatos = [];
    try {
      const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const vistos = new Set();
      for (const [key, e] of Object.entries(saved)) {
        if (!e || e.audio_url) continue;                      // ya está offline
        if (!e.video_id && !e.title && !e.name) continue;     // entrada vacía
        const grupo = e.video_id || ((e.artist || "") + "|" + (e.name || e.title || key)).toLowerCase();
        if (vistos.has(grupo)) continue;
        vistos.add(grupo);
        candidatos.push({ key, e });
      }
    } catch { return; }
    if (!candidatos.length) return;
    setQueue(prev => {
      /* Las reparaciones que fallaron antes vuelven a intentarse en
         este ciclo (la Mac pudo haber terminado mientras tanto). */
      const base = prev.map(t => (t.repair && t.status === "failed") ? { ...t, status: "pending" } : t);
      const enCola = new Set(base.filter(t => t.status !== "done").map(t => t.key));
      const nuevos = [];
      for (const { key, e } of candidatos.slice(0, 6)) {
        if (enCola.has(key)) continue;
        nuevos.push({
          id: `fix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${nuevos.length}`,
          key,
          name: e.name || e.title || key,
          artist: e.artist || "",
          cover: e.cover || "",
          duration_ms: e.duration_ms || null,
          /* Con el video exacto no hace falta volver a buscar en YouTube,
             y la Mac lo encuentra en su caché por id. */
          video_id: e.video_id || "",
          query: (e.artist && e.name) ? "" : (/^\d+$/.test(key) ? (e.title || "") : key),
          repair: true,
          status: "pending",
          savedAt: Date.now(),
        });
      }
      const resultado = nuevos.length ? [...base, ...nuevos] : base;
      return resultado;
    });
  }, []);

  useEffect(() => {
    const t0 = setTimeout(autoRepair, 8000);                    // al abrir
    const cada = setInterval(autoRepair, 5 * 60 * 1000);        // y cada 5 min
    const alVolver = () => { if (navigator.onLine) autoRepair(); };
    window.addEventListener("online", alVolver);
    return () => { clearTimeout(t0); clearInterval(cada); window.removeEventListener("online", alVolver); };
  }, [autoRepair]);

  // Cada vez que cambia la cola la persistimos.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch {}
  }, [queue]);

  // Procesador principal: si hay un pendiente y nada está corriendo, lo toma.
  useEffect(() => {
    if (running) return;
    const siguiente = queue.find(t => t.status === "pending");
    if (!siguiente) return;
    setRunning(true);
    activeRef.current = siguiente.id;
    (async () => {
      try {
        await processOne(siguiente, queue, setQueue);
      } catch (e) {
        setQueue(prev => prev.map(t => t.id === siguiente.id ? { ...t, status: "failed", error: String(e.message || e).slice(0, 120) } : t));
      } finally {
        activeRef.current = null;
        setRunning(false);
      }
    })();
  }, [queue, running]);

  const enqueueAlbum = useCallback((albumName, tracks) => {
    if (!tracks || !tracks.length) return;
    setQueue(prev => {
      const existing = new Set(prev.map(t => t.key));
      const nuevos = tracks
        .filter(t => !existing.has(t.key))
        .map((t, i) => ({
          id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`,
          key: t.key,
          name: t.name,
          artist: t.artist,
          cover: t.cover,
          duration_ms: t.duration_ms || null,
          status: "pending",
          savedAt: Date.now() + i,
        }));
      if (nuevos.length === 0) return prev;
      ensureNotificationPermission();
      return [...prev, ...nuevos];
    });
  }, []);

  const clearDone = useCallback(() => {
    setQueue(prev => prev.filter(t => t.status !== "done"));
  }, []);

  return (
    <DownloadContext.Provider value={{ queue, enqueueAlbum, clearDone, running }}>
      {children}
    </DownloadContext.Provider>
  );
}

async function processOne(track, currentQueue, setQueue) {
  setQueue(prev => prev.map(t => t.id === track.id ? { ...t, status: "downloading" } : t));
  const sq = ((track.artist + " " + track.name).trim() || track.query || String(track.key || "")).trim();
  const params = new URLSearchParams();
  params.set("q", sq);
  /* Reparación: ya sabemos el video exacto → Vercel no busca en YouTube
     y la Mac lo encuentra en su caché por id. Respuesta casi instantánea. */
  if (track.video_id) params.set("v", track.video_id);
  // Duracion real (de iTunes, en segundos) para que el filtro de YouTube
  // busque una version de longitud similar y NO un live/mashup de 7-8 min.
  if (track.duration_ms) {
    params.set("expected_duration", Math.round(track.duration_ms / 1000));
  }
  // Artista (de iTunes) para que el filtro EXIJA un canal del artista, no un
  // karaoke/tribute de otro subiendo la misma cancion con titulo parecido.
  if (track.artist) {
    params.set("expected_artist", track.artist);
  }
  // Titulo esperado de iTunes para que el filtro descarte videos de 'otra
  // cancion con nombre parecido'. Si mas de la mitad de las palabras
  // significativas del titulo no aparecen en el titulo del video -> descartado.
  if (track.name) {
    params.set("expected_song", track.name);
  }
  const res = await fetch("/api/download-mp3?" + params.toString());
  let data = await res.json().catch(() => ({}));

  /* La Mac baja la canción en segundo plano y el server responde
     "pendiente" mientras tanto. Reintentamos cada 10 s hasta que el
     archivo esté listo (o nos rendimos tras ~2 minutos y queda como
     reproducción por YouTube). En los reintentos mandamos v=<video_id>
     para que Vercel no repita la búsqueda de YouTube. */
  const MAX_REINTENTOS = 12;
  for (let intento = 0; intento < MAX_REINTENTOS && data.pendiente && !data.audio_url; intento++) {
    if (data.video_id && !params.get("v")) params.set("v", data.video_id);
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const r2 = await fetch("/api/download-mp3?" + params.toString());
      data = await r2.json().catch(() => data);
    } catch {}
  }

  let guardadoOffline = false;
  if (data.audio_url && "caches" in window) {
    try {
      const c = await caches.open("ml-saved-v1");
      const r = await fetch(data.audio_url, { headers: { Accept: "audio/*,*/*" } });
      if (r.ok && r.status === 200) {
        await c.put(data.audio_url, r.clone());
        guardadoOffline = true;
      }
    } catch {}
  }

  try {
    const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
    /* No pisamos datos buenos que ya existieran (carátula, nombre real,
       o un audio_url previo) con datos peores de este intento. */
    const previo = saved[sq] || (track.key ? saved[String(track.key)] : null) || {};
    const tieneAudio = guardadoOffline || Boolean(previo.audio_url);
    const entry = {
      video_id: data.video_id || previo.video_id || "",
      audio_url: guardadoOffline ? data.audio_url : (previo.audio_url || ""),
      apple_url: data.apple_url || previo.apple_url || "",
      method: tieneAudio ? "audio" : "youtube",
      title: data.title || data.video_title || previo.title || track.name,
      /* Datos REALES de la canción (iTunes): en reparaciones preferimos
         lo que ya estaba guardado; en descargas nuevas, lo que viene
         del track. Nunca el título del video de YouTube. */
      name: (track.repair ? (previo.name || track.name) : (track.name || previo.name)) || "",
      artist: (track.repair ? (previo.artist || track.artist) : (track.artist || previo.artist)) || "",
      cover: (track.repair ? (previo.cover || track.cover) : (track.cover || previo.cover)) || "",
      saved_at: Date.now(),
    };
    saved[sq] = entry;
    if (track.key) saved[String(track.key)] = entry;
    localStorage.setItem("ml_mp3", JSON.stringify(saved));
  } catch {}

  /* Una reparación solo "termina" si consiguió el archivo; si no, queda
     como fallida y se vuelve a intentar en la próxima apertura o ciclo. */
  const exito = guardadoOffline || !track.repair;
  setQueue(prev => prev.map(t => t.id === track.id
    ? { ...t, status: exito ? "done" : "failed",
        error: exito ? undefined : "la Mac aún la está bajando; se reintenta solo",
        savedAt: Date.now(), bytes: data.bytes || 0 }
    : t));

  if (track.repair) {
    if (guardadoOffline) {
      notifyBrowser("Ahora disponible sin internet", `${track.name} — ${track.artist}`, track.cover);
    }
    return;   // sin notificación de "álbum listo" para reparaciones
  }

  notifyBrowser(
    guardadoOffline ? "Guardada sin internet" : "Guardada",
    `${track.name} — ${track.artist}`,
    track.cover
  );

  const restantes = currentQueue.filter(t => t.id !== track.id && t.status === "pending").length;
  if (restantes === 0) {
    notifyBrowser("Álbum listo", `Todas las canciones de "${track.artist}" están guardadas`, track.cover);
  }
}

export function useDownloads() {
  return useContext(DownloadContext);
}
