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
        if (Array.isArray(saved)) setQueue(saved.filter(t => t.status !== "done"));
      }
    } catch {}
    ensureNotificationPermission();
  }, []);

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
  const sq = (track.artist + " " + track.name).trim();
  const params = new URLSearchParams();
  params.set("q", sq);
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
  const res = await fetch("/api/download-mp3?" + params.toString());
  const data = await res.json().catch(() => ({}));

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
    const entry = {
      video_id: data.video_id || "",
      audio_url: guardadoOffline ? data.audio_url : "",
      apple_url: data.apple_url || "",
      method: guardadoOffline ? "audio" : "youtube",
      title: data.title || data.video_title || track.name,
      saved_at: Date.now(),
    };
    saved[sq] = entry;
    if (track.key) saved[String(track.key)] = entry;
    localStorage.setItem("ml_mp3", JSON.stringify(saved));
  } catch {}

  setQueue(prev => prev.map(t => t.id === track.id ? { ...t, status: "done", savedAt: Date.now(), bytes: data.bytes || 0 } : t));

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
