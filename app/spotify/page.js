"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";
import { useDownloads } from "../components/DownloadManager";

// Iconos SVG (mismo trazo de línea que el resto de la app)
function Ico({ d, size = 16, fill = "none", stroke = "currentColor", sw = 2 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>{d}</svg>;
}

export default function SpotifyPage() {
  const { user, favorites, isFavorite, toggleFavorite, checkSession } = useUser();
  const { enqueueAlbum } = useDownloads();
  const [playlistModal, setPlaylistModal] = useState(null);
  const [tab, setTab] = useState("discover"); // discover, search, url, itunes
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  useEffect(() => {
    try { setRecentSearches(JSON.parse(localStorage.getItem("aura_busquedas") || "[]")); } catch {}
  }, []);
  function borrarRecientes() {
    try { localStorage.removeItem("aura_busquedas"); } catch {}
    setRecentSearches([]);
  }
  const [album, setAlbum] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oembedUrl, setOembedUrl] = useState("");
  const [oembedResult, setOembedResult] = useState(null);
  const [downloading, setDownloading] = useState("");
  const [charts, setCharts] = useState(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [playingTrack, setPlayingTrack] = useState(null);
  const [savedOfflineIds, setSavedOfflineIds] = useState(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      return new Set(Object.keys(saved));
    } catch { return new Set(); }
  });
  const toast = useToast();

  // Checar si una canción ya está guardada offline
  function isSavedOffline(itemId) {
    return savedOfflineIds.has(String(itemId));
  }

  // Agregar ID a la lista de guardados offline
  function addSavedOfflineId(itemId) {
    setSavedOfflineIds(prev => new Set([...prev, String(itemId)]));
  }

  // Quitar ID de la lista de guardados offline
  function removeSavedOfflineId(itemId) {
    setSavedOfflineIds(prev => { const n = new Set(prev); n.delete(String(itemId)); return n; });
  }

  // Checar si una canción tiene MP3 completo disponible offline
  function hasFullMp3(trackId, trackName, trackArtist) {
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const keys = [
        String(trackId),
        (trackArtist + " " + trackName).trim(),
        (trackName + " " + trackArtist).trim(),
        trackName.trim(),
      ];
      for (const k of keys) {
        if (mp3s[k]?.audio_url) return true;
      }
    } catch {}
    return false;
  }

  // Sincronizar offline con favoritos — si se elimina un álbum favorito, quitarlo y sus canciones de offline
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const favIds = new Set(favorites.map(f => f.item_id));
      let changed = false;
      for (const id of Object.keys(saved)) {
        const entry = saved[id];
        // Si es un álbum que ya no es favorito, eliminarlo + sus canciones
        if (!entry.album_id && !favIds.has(id)) {
          const trackIds = entry.track_ids || [];
          for (const tid of trackIds) { delete saved[tid]; }
          delete saved[id];
          changed = true;
        }
        // Si es una canción cuyo álbum ya no está en offline, eliminarla
        if (entry.album_id && !saved[entry.album_id]) {
          delete saved[id];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem("ml_offline", JSON.stringify(saved));
        setSavedOfflineIds(new Set(Object.keys(saved)));
      }
    } catch {}
  }, [favorites]);
  const audioRef = useRef(null);

  // Load charts on mount
  useEffect(() => {
    loadCharts();
    const params = new URLSearchParams(window.location.search);
    const albumId = params.get("album");
    const artistId = params.get("artist");
    const source = params.get("source") || "itunes";
    if (albumId) loadAlbum(albumId, source);
    else if (artistId) loadArtist(artistId);
  }, []);

  // Single audio element for previews
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => { setPlayingTrack(null); if(navigator.mediaSession){ navigator.mediaSession.playbackState = "none"; navigator.mediaSession.metadata = null; } });
    }
  }, []);

  async function playPreview(url, trackId, trackName, trackArtist, trackCover, trackDurMs) {
    const audio = audioRef.current;
    if (!audio) return;
    /* Corte de seguridad: si el archivo trae cola de más (silencio/ruido
       al final), lo terminamos en la duración real de iTunes + 12 s. */
    try {
      if (audio._auraCap) { audio.removeEventListener("timeupdate", audio._auraCap); audio._auraCap = null; }
      if (trackDurMs && trackDurMs > 0) {
        const fin = trackDurMs / 1000 + 12;
        const cap = () => {
          if (audio.currentTime >= fin) {
            audio.removeEventListener("timeupdate", cap);
            audio._auraCap = null;
            try { audio.pause(); } catch {}
            setPlayingTrack(null);
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
          }
        };
        audio._auraCap = cap;
        audio.addEventListener("timeupdate", cap);
      }
    } catch {}
    if (playingTrack === trackId) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingTrack(null);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      return;
    }
    // Stop current and play new
    audio.pause();
    audio.currentTime = 0;
    
    // Check if we have a full MP3 cached — try multiple strategies
    let playUrl = url;
    let isFullMp3 = false;
    
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      // Try multiple key formats: by track ID, by artist+name, by name+artist, by name only
      const keys = [
        String(trackId),
        (trackArtist + " " + trackName).trim(),
        (trackName + " " + trackArtist).trim(),
        trackName.trim(),
      ];
      for (const k of keys) {
        if (mp3s[k]?.audio_url) {
          playUrl = mp3s[k].audio_url;
          isFullMp3 = true;
          break;
        }
      }
    } catch {}
    
    // If we found a full MP3 URL, try to serve it from Service Worker cache
    // (YouTube audio URLs expire quickly, so cache is essential)
    if (isFullMp3 && playUrl !== url && "caches" in window) {
      try {
        const cache = await caches.open("ml-saved-v1");
        const cached = await cache.match(playUrl);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          if (blob.size > 1000) { // Valid audio file
            playUrl = URL.createObjectURL(blob);
          } else {
            // Cached file is too small (corrupt), fall back to preview
            playUrl = url;
            isFullMp3 = false;
          }
        } else {
          // Not in cache anymore — the URL probably expired
          // Try fetching directly (might work if URL hasn't expired yet)
          try {
            const directRes = await fetch(playUrl, { mode: "no-cors" });
            // If we get here, the URL might work — but no-cors doesn't let us read it
            // So we just try to use it directly
          } catch {
            // URL expired, fall back to preview
            playUrl = url;
            isFullMp3 = false;
          }
        }
      } catch {
        // Cache error, try the URL directly
      }
    }
    
    // Show notification if playing full MP3 vs preview
    if (isFullMp3) {
      toast.success("🎵 Reproduciendo MP3 completo: " + trackName, 3000);
    }
    
    audio.src = playUrl;
    setPlayingTrack(trackId);

    // Set media session BEFORE playing
    if ("mediaSession" in navigator) {
      const coverUrl = trackCover || album?.cover_xl || album?.cover_big || album?.cover_medium || "";
      // Proxy the artwork image so Media Session can use it (avoids CORS issues)
      const artworkSrc = coverUrl ? "/api/proxy?url=" + encodeURIComponent(coverUrl) : "";
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: trackName || "Cancion",
          artist: trackArtist || album?.artist || "",
          album: album?.name || "",
          artwork: artworkSrc ? [
            { src: artworkSrc, sizes: "96x96", type: "image/jpeg" },
            { src: artworkSrc, sizes: "256x256", type: "image/jpeg" },
            { src: artworkSrc, sizes: "512x512", type: "image/jpeg" },
          ] : [],
        });
      } catch(e) {}
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => {
        audio.play().catch(() => {});
        navigator.mediaSession.playbackState = "playing";
        setPlayingTrack(trackId);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audio.pause();
        navigator.mediaSession.playbackState = "paused";
      });
      navigator.mediaSession.setActionHandler("stop", () => {
        audio.pause(); audio.currentTime = 0;
        setPlayingTrack(null);
        navigator.mediaSession.playbackState = "none";
      });
      // Handle next/previous as no-ops to prevent errors
      try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
      try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
    }

    // Play audio first - then set metadata once it starts playing
    audio.play().then(() => {
      // Re-set metadata after play succeeds (some browsers need this)
      if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
        navigator.mediaSession.playbackState = "playing";
      }
    }).catch(() => {});
  }

  async function loadCharts() {
    setChartsLoading(true);
    try {
      // Get top charts from iTunes + new releases
      const [topRes, newRes, latRes] = await Promise.all([
        fetch("/api/music?action=search&q=top+hits+2026&source=itunes&entity=album&limit=10").catch(() => null),
        fetch("/api/music?action=search&q=new+release+2026&source=itunes&entity=album&limit=10").catch(() => null),
        fetch("/api/music?action=search&q=latin+music+hits&source=itunes&entity=album&limit=10").catch(() => null),
      ]);
      const topData = topRes ? await topRes.json().catch(() => ({})) : {};
      const newData = newRes ? await newRes.json().catch(() => ({})) : {};
      const latData = latRes ? await latRes.json().catch(() => ({})) : {};
      setCharts({
        top: topData.albums || [],
        newReleases: newData.albums || [],
        latin: latData.albums || [],
      });
    } catch {
      setCharts({ top: [], newReleases: [], latin: [] });
    }
    setChartsLoading(false);
  }

  // Get recommendations based on user favorites
  function getRecommendations() {
    if (!favorites || favorites.length === 0) return [];
    // Use favorite artists/albums as search terms
    const terms = [...new Set(favorites.slice(0, 5).map(f => f.artist || f.name).filter(Boolean))];
    return terms;
  }

  async function search(qOverride) {
    const q = (typeof qOverride === "string" ? qOverride : query).trim();
    if (!q) return;
    if (typeof qOverride === "string") setQuery(qOverride);
    setLoading(true); setError(""); setResults(null); setAlbum(null); setArtist(null);
    try {
      const res = await fetch("/api/music?action=search&q=" + encodeURIComponent(q) + "&source=auto&limit=20");
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setResults(data);
        /* Búsquedas recientes (estilo Spotify): guardamos las últimas 8 */
        try {
          const prev = JSON.parse(localStorage.getItem("aura_busquedas") || "[]");
          const nuevas = [q, ...prev.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
          localStorage.setItem("aura_busquedas", JSON.stringify(nuevas));
          setRecentSearches(nuevas);
        } catch {}
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadAlbum(albumId, source = "itunes") {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try {
      const endpoint = "/api/music?action=lookup&id=" + albumId + "&source=itunes";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAlbum(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadArtist(artistId) {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try {
      const res = await fetch("/api/music?action=lookup&id=" + artistId + "&source=itunes");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setArtist(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function resolveOEmbed() {
    if (!oembedUrl.trim()) return;
    setLoading(true); setError(""); setOembedResult(null);
    try {
      const res = await fetch("/api/music?action=oembed&url=" + encodeURIComponent(oembedUrl.trim()));
      const data = await res.json();
      if (data.error) setError(data.error);
      else setOembedResult(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function downloadImage(url, filename) {
    setDownloading(filename);
    try {
      const a = document.createElement("a");
      a.href = "/api/download?url=" + encodeURIComponent(url) + "&filename=" + encodeURIComponent(filename);
      a.click();
    } catch {}
    setTimeout(() => setDownloading(""), 2000);
  }

  async function handleFavorite(e, itemType, itemId, name, artistName, coverUrl, source, extraData) {
    e.stopPropagation();
    const wasFav = isFavorite(itemType, String(itemId));
    toggleFavorite(itemType, String(itemId), name, artistName, coverUrl, source, extraData);
    
    if (wasFav) {
      // Se quitó el ❤️ → eliminar canciones del álbum de favoritos + offline
      if (itemType === "album") {
        // Eliminar todas las canciones del álbum de favoritos
        const albumTracks = favorites.filter(f => f.item_type === "track" && (f.extra_data?.album_id === String(itemId) || f.item_id?.startsWith(String(itemId) + "-")));
        for (const tf of albumTracks) {
          toggleFavorite("track", tf.item_id);
        }
      }
      // Eliminar del offline cache
      try {
        const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
        const entry = saved[String(itemId)];
        if (entry) {
          const trackIds = entry.track_ids || [];
          for (const tid of trackIds) delete saved[tid];
          delete saved[String(itemId)];
          localStorage.setItem("ml_offline", JSON.stringify(saved));
        }
        // Eliminar canciones del álbum también
        for (const key of Object.keys(saved)) {
          if (saved[key].album_id === String(itemId)) delete saved[key];
        }
        localStorage.setItem("ml_offline", JSON.stringify(saved));
        // Refrescar palomitas
        setSavedOfflineIds(new Set(Object.keys(saved)));
      } catch {}
      toast.error("💔 Eliminada de favoritos y offline", 3000);
    } else {
      // Se puso el ❤️ → también guardar offline
      if (coverUrl) {
        try {
          if ("caches" in window) {
            const cache = await caches.open("ml-saved-v1");
            await cache.add(coverUrl);
            try { await cache.add("/api/proxy?url=" + encodeURIComponent(coverUrl)); } catch {}
          }
        } catch {}
      }
      // Si es álbum, guardar todas las canciones como favoritos + offline
      if (itemType === "album" && album?.tracks) {
        const trackIds = [];
        for (let i = 0; i < album.tracks.length; i++) {
          const t = album.tracks[i];
          const tKey = String(t.id || `${itemId}-${i}`);
          // Agregar cada canción a favoritos
          if (!isFavorite("track", tKey)) {
            toggleFavorite("track", tKey, t.name, t.artist || artistName, coverUrl, source, { preview_url: t.preview_url || "", album_id: String(itemId) });
          }
          // Cachear audio preview
          if (t.preview_url) {
            try { if ("caches" in window) { const c = await caches.open("ml-saved-v1"); await c.add(t.preview_url); } } catch {}
          }
          // Guardar metadata offline
          try {
            const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
            saved[tKey] = { name: t.name, artist: t.artist || artistName, cover_url: coverUrl, source, album_id: String(itemId), saved_at: Date.now() };
            localStorage.setItem("ml_offline", JSON.stringify(saved));
          } catch {}
          trackIds.push(tKey);
        }
        for (const tid of trackIds) addSavedOfflineId(tid);
        // Guardar album metadata con track_ids
        try {
          const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
          saved[String(itemId)] = { name, artist: artistName, cover_url: coverUrl, source, saved_at: Date.now(), track_ids: trackIds };
          localStorage.setItem("ml_offline", JSON.stringify(saved));
        } catch {}
      } else {
        // Canción individual
        const previewUrl = extraData?.preview_url;
        if (previewUrl) {
          try { if ("caches" in window) { const c = await caches.open("ml-saved-v1"); await c.add(previewUrl); } } catch {}
        }
        try {
          const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
          saved[String(itemId)] = { name, artist: artistName, cover_url: coverUrl, source, saved_at: Date.now() };
          localStorage.setItem("ml_offline", JSON.stringify(saved));
        } catch {}
      }
      addSavedOfflineId(itemId);
      // Cola en segundo plano con notificaciones.
      if (itemType === "album" && album?.tracks) {
        const tracksForQueue = album.tracks.map((t, i) => ({
          key: String(t.id || `${itemId}-${i}`),
          name: t.name,
          artist: t.artist || artistName,
          cover: coverUrl,
          duration_ms: t.duration_ms || null,
        }));
        enqueueAlbum(name, tracksForQueue);
      } else {
        let durMs = null;
        if (extraData && extraData.duration_ms) durMs = extraData.duration_ms;
        else if (album && album.tracks) {
          const tk = album.tracks.find(t => String(t.id) === String(itemId) || t.name === name);
          if (tk && tk.duration_ms) durMs = tk.duration_ms;
        }
        enqueueAlbum(name, [{ key: String(itemId), name, artist: artistName, cover: coverUrl, duration_ms: durMs }]);
      }
      const msg = itemType === "album" ? "Álbum guardado — descargando en segundo plano" : "Guardada — descargando en segundo plano";
      toast.info(msg, 4000);
    }
  }

  function handleAddToPlaylist(e, itemType, itemId, name, artistName, coverUrl, source) {
    e.stopPropagation();
    setPlaylistModal({ item_type: itemType, item_id: String(itemId), name, artist: artistName, cover_url: coverUrl, source });
  }

  async function handleSaveOffline(e, itemType, itemId, name, artistName, source, sourceUrl, coverUrl) {
    e.stopPropagation();
    // Si ya está guardado offline, solo mostrar mensaje
    if (isSavedOffline(itemId)) {
      toast.info("🎵 Ya está disponible offline", 3000);
      return;
    }
    // 1) Guardar en favoritos (perfil)
    if (!isFavorite(itemType, String(itemId))) {
      toggleFavorite(itemType, String(itemId), name, artistName, coverUrl, source);
    }
    // 2) Guardar portada en caché para ver sin internet
    if (coverUrl) {
      try {
        if ("caches" in window) {
          const cache = await caches.open("ml-saved-v1");
          await cache.add(coverUrl);
          try { await cache.add("/api/proxy?url=" + encodeURIComponent(coverUrl)); } catch {}
        }
      } catch {}
    }
    // 3) Si es álbum, guardar TODAS las canciones también
    if (itemType === "album" && album?.tracks) {
      const trackIds = [];
      for (let i = 0; i < album.tracks.length; i++) {
        const t = album.tracks[i];
        const tKey = String(t.id || `${itemId}-${i}`);
        // Agregar cada canción a favoritos (perfil)
        if (!isFavorite("track", tKey)) {
          toggleFavorite("track", tKey, t.name, t.artist || artistName, coverUrl, source, { preview_url: t.preview_url || "", album_id: String(itemId) });
        }
        // Guardar preview de audio en caché
        if (t.preview_url) {
          try {
            if ("caches" in window) {
              const cache = await caches.open("ml-saved-v1");
              await cache.add(t.preview_url);
            }
          } catch {}
        }
        // Guardar metadata de cada canción
        try {
          const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
          saved[tKey] = { name: t.name, artist: t.artist || artistName, cover_url: coverUrl, source, album_id: String(itemId), saved_at: Date.now() };
          localStorage.setItem("ml_offline", JSON.stringify(saved));
        } catch {}
        trackIds.push(tKey);
      }
      // Actualizar palomitas de todas las canciones
      for (const tid of trackIds) addSavedOfflineId(tid);
    } else {
      // Canción individual: guardar preview de audio
      const track = album?.tracks?.find(t => String(t.id) === String(itemId) || t.name === name);
      if (track?.preview_url) {
        try {
          if ("caches" in window) {
            const cache = await caches.open("ml-saved-v1");
            await cache.add(track.preview_url);
          }
        } catch {}
      }
    }
    // Guardar metadata del item principal en localStorage
    try {
      const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const entry = { name, artist: artistName, cover_url: coverUrl, source, source_url: sourceUrl, saved_at: Date.now() };
      // Si es álbum, guardar los IDs de las canciones para poder eliminarlas después
      if (itemType === "album" && album?.tracks) {
        entry.track_ids = album.tracks.map((t, i) => String(t.id || `${itemId}-${i}`));
      }
      saved[String(itemId)] = entry;
      localStorage.setItem("ml_offline", JSON.stringify(saved));
    } catch {}
    const msg = itemType === "album" ? "✅ Álbum guardado offline con todas sus canciones" : "✅ Guardada para ver sin internet";
    toast.success(msg, 4000);
    addSavedOfflineId(itemId);
  }

  // ── Styles ──
  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text-strong)", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };
  const BS = { padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: "0.9em", cursor: "pointer", fontWeight: 600 };
  const TabS = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: active ? "var(--accent)" : "var(--panel)", color: active ? "#fff" : "var(--text3)", fontSize: "0.85em", cursor: "pointer", fontWeight: active ? 700 : 400 });

  const albums = results?.albums || [];
  const artists = results?.artists || [];
  const src = results?.source || "";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "15px 20px", minHeight: "100vh", position: "relative" }}>
      {playlistModal && <AddToPlaylistModal item={playlistModal} onClose={() => setPlaylistModal(null)} />}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setTab("discover"); setAlbum(null); setArtist(null); setResults(null); setQuery(""); setError(""); }} style={TabS(tab === "discover" && !album && !artist)}><Ico d={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />} size={16} stroke="var(--accent)" fill="var(--accent)" /> Descubrir</button>
        <button onClick={() => { setTab("search"); setAlbum(null); setArtist(null); }} style={TabS(tab === "search" && !album && !artist)}>Buscar</button>
      </div>

      {/* ── TAB: Discover ── */}
      {tab === "discover" && !album && !artist && (
        <div>
          {/* Quick search */}
          <div style={{ display: "flex", gap: 8, marginBottom: 25, flexWrap: "wrap" }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas..." style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={() => { setTab("search"); search(); }} disabled={loading} style={BS}>{loading ? "..." : "Buscar"}</button>
          </div>

          {/* For You - based on favorites */}
          {favorites.length > 0 && (
            <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />} size={18} stroke="#ec4899" fill="#ec4899" />} title="Para ti" subtitle="Basado en tus favoritos" />
              <RecommendationRow favorites={favorites} onSelect={(id, src) => loadAlbum(id, src)} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
            </div>
          )}

          {/* Charts */}
          {chartsLoading ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--accent)" }}>Cargando recomendaciones...</div>
          ) : charts && (
            <>
              {charts.latin?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<path d="M12 2s4 4 4 9a4 4 0 0 1-8 0c0-1 .5-2 1-3-2 1-4 3-4 6a6 6 0 0 0 12 0c0-5-5-9-5-9z" />} size={18} stroke="#f97316" fill="#f97316" />} title="Latin Hits" subtitle="Lo más escuchado" />
                  <HorizontalAlbumRow albums={charts.latin.slice(0, 8)} onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.newReleases?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></>} size={18} stroke="#fbbf24" fill="#fbbf24" />} title="Nuevos lanzamientos" subtitle="Lo más reciente" />
                  <HorizontalAlbumRow albums={charts.newReleases.slice(0, 8)} onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.top?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z" /></>} size={18} stroke="#38bdf8" />} title="Top Global" subtitle="Los más populares" />
                  <HorizontalAlbumRow albums={charts.top.slice(0, 8)} onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Search ── */}
      {tab === "search" && !album && !artist && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas... (ej: Bad Bunny, Rosalía)" style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={search} disabled={loading} style={BS}>{loading ? "..." : "Buscar"}</button>
          </div>
          {/* Búsquedas recientes (estilo Spotify) */}
          {!loading && !results && recentSearches.length > 0 && (
            <div style={{ marginBottom: 25 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "var(--text3)", fontSize: "0.85em", fontWeight: 700 }}>Búsquedas recientes</span>
                <button onClick={borrarRecientes} style={{ background: "none", border: "none", color: "var(--text5)", fontSize: "0.75em", cursor: "pointer", textDecoration: "underline" }}>Borrar</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {recentSearches.map(t => (
                  <button key={t} onClick={() => search(t)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text2)", fontSize: "0.85em", cursor: "pointer" }}>
                    <Ico d={<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>} size={13} stroke="var(--accent)" /> {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {!loading && results && (
            <div>
              <SourceBadge source={src} />
              {artists.length > 0 && (
                <div style={{ marginBottom: 25 }}>
                  <SectionHeader icon="" title="Artistas" subtitle="" />
                  <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10 }}>
                    {artists.map(a => (
                      <div key={a.id} onClick={() => loadArtist(a.id)} style={{ flex: "0 0 110px", background: "var(--panel)", borderRadius: 12, padding: 10, textAlign: "center", cursor: "pointer", border: "1px solid var(--border)", position: "relative" }}>
                        <ActionBtn pos="top-right" active={isFavorite("artist", a.id)} onClick={e => handleFavorite(e, "artist", a.id, a.name, "", a.picture_medium, a.source || "itunes")} type="fav" />
                        {a.picture_medium ? <img src={a.picture_medium} style={{ width: 70, height: 70, borderRadius: "50%", objectFit: "cover", marginBottom: 6 }} /> : <div style={{ width: 70, height: 70, borderRadius: "50%", background: "var(--border)", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center" }}>?</div>}
                        <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {albums.length > 0 && (
                <div>
                  <SectionHeader icon="" title="Álbumes" subtitle="" />
                  <AlbumGrid albums={albums} source={src} onSelect={(id) => loadAlbum(id, src)} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
                </div>
              )}
              {!loading && results && albums.length === 0 && artists.length === 0 && <p style={{ textAlign: "center", color: "var(--text5)", padding: 40 }}>No se encontraron resultados</p>}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: URL ── */}
      {tab === "url" && !album && !artist && (
        <div>
          <p style={{ color: "var(--text3)", fontSize: "0.9em", marginBottom: 15 }}>Pegá cualquier URL de Spotify (álbum, canción, playlist):</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 15, flexWrap: "wrap" }}>
            <input value={oembedUrl} onChange={e => setOembedUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && resolveOEmbed()} placeholder="https://open.spotify.com/album/..." style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={resolveOEmbed} disabled={loading} style={BS}>{loading ? "..." : "Obtener"}</button>
          </div>
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {oembedResult && !loading && (
            <div style={{ background: "var(--panel)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginBottom: 15 }}>
                <img src={oembedResult.thumbnail_large || oembedResult.thumbnail} style={{ width: 160, height: 160, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <h2 style={{ fontSize: "1.2em", marginBottom: 5 }}>{oembedResult.title}</h2>
                  <p style={{ color: "#1ed760", marginBottom: 10 }}>{oembedResult.provider}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Ítem 8: botones Grande/Mini del oembed ya no se muestran */}
                  </div>
                </div>
              </div>
              {oembedResult.html && <div style={{ borderRadius: 12, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: oembedResult.html.replace(/height="\d+"/, 'height="352"') }} />}
            </div>
          )}
        </div>
      )}

      {/* ── Album Detail ── */}
      {album && !loading && (
        <div>
          <BackBtn onClick={() => setAlbum(null)} />
          <div style={{ background: "var(--panel)", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <img src={album.cover_xl || album.cover_big || album.cover_medium} style={{ width: 220, height: 220, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", gap: 4 }}>
                <ActionBtn active={isFavorite("album", album.id)} onClick={e => handleFavorite(e, "album", album.id, album.name, album.artist, album.cover_xl || album.cover_big, album.source)} type="fav" size="lg" />
                <ActionBtn active={false} onClick={e => handleAddToPlaylist(e, "album", album.id, album.name, album.artist, album.cover_xl || album.cover_big, album.source)} type="add" size="lg" />
                <ShareBtn onClick={e => handleFavorite(e, "album", album.id, album.name, album.artist, album.cover_xl || album.cover_big, album.source)} saved={isFavorite("album", album.id)} size="lg" />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h2 style={{ fontSize: "1.4em", marginBottom: 4 }}>{album.name}</h2>
              {album.artist_id && album.source === "itunes" ? (
                <p style={{ color: "#1ed760", marginBottom: 4, cursor: "pointer" }} onClick={() => { setAlbum(null); loadArtist(album.artist_id); }}>{album.artist}</p>
              ) : <p style={{ color: "#1ed760", marginBottom: 4 }}>{album.artist}</p>}
              <p style={{ color: "var(--text3)", marginBottom: 2, fontSize: "0.9em" }}>{album.release_date || album.year} {album.total_tracks ? `— ${album.total_tracks} canciones` : ""} {album.track_count ? `— ${album.track_count} canciones` : ""}</p>
              {album.label && <p style={{ color: "var(--text5)", fontSize: "0.8em" }}>Sello: {album.label}</p>}
              {album.genre && <p style={{ color: "var(--text5)", fontSize: "0.8em" }}>Género: {album.genre}</p>}
              {/* Ítem 8: ya no se descargan portadas (Grande/Mini) en el álbum */}
            </div>
          </div>
          {album.tracks?.length > 0 && (
            <div>
              <SectionHeader icon="" title="Canciones" subtitle="" />
              <div style={{ background: "var(--panel)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                {album.tracks.map((track, i) => {
                  const trackKey = String(track.id || `${album.id}-${i}`);
                  const isPlaying = playingTrack === trackKey;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ color: "var(--text5)", width: 22, textAlign: "right", fontSize: "0.82em" }}>{track.number || i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--text)", fontSize: "0.9em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                        {track.artist && track.artist !== album.artist && <div style={{ color: "var(--text4)", fontSize: "0.75em" }}>{track.artist}</div>}
                      </div>
                      {track.duration && <span style={{ color: "var(--text5)", fontSize: "0.82em", flexShrink: 0 }}>{track.duration}</span>}
                      <ActionBtn active={isFavorite("track", trackKey)} onClick={e => handleFavorite(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source, { preview_url: track.preview_url || "", album_id: album.id || "", duration_ms: track.duration_ms || 0 })} type="fav" size="sm" />
                      <ActionBtn active={false} onClick={e => handleAddToPlaylist(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source)} type="add" size="sm" />
                      <ShareBtn onClick={e => handleFavorite(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source, { preview_url: track.preview_url || "", album_id: album.id || "" })} saved={isFavorite("track", trackKey)} size="sm" />

                      {track.preview_url && (
                        <button onClick={() => playPreview(track.preview_url, trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, track.duration_ms || 0)} style={{ background: isPlaying ? "var(--accent)" : hasFullMp3(trackKey, track.name, track.artist || album.artist) ? "rgba(34,197,94,0.2)" : "rgba(124,92,252,0.15)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
                          <svg width="10" height="12" viewBox="0 0 10 12" fill={isPlaying ? "#fff" : hasFullMp3(trackKey, track.name, track.artist || album.artist) ? "#22c55e" : "var(--accent)"}>
                            {isPlaying ? <><rect x="0" y="1" width="3" height="10" rx="1"/><rect x="6" y="1" width="3" height="10" rx="1"/></> : <polygon points="0,0 10,6 0,12"/>}
                          </svg>
                          {hasFullMp3(trackKey, track.name, track.artist || album.artist) && !isPlaying && (
                            <span style={{ position: "absolute", bottom: -1, right: -1, width: 8, height: 8, background: "#22c55e", borderRadius: "50%", border: "1.5px solid #0f0f1a" }}></span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Artist Detail ── */}
      {artist && !loading && (
        <div>
          <BackBtn onClick={() => setArtist(null)} />
          <div style={{ background: "var(--panel)", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid var(--border)", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              {artist.picture_xl ? <img src={artist.picture_xl} style={{ width: 150, height: 150, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} /> : <div style={{ width: 150, height: 150, borderRadius: "50%", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3em" }}>?</div>}
              <div style={{ position: "absolute", bottom: 4, right: 4 }}>
                <ActionBtn active={isFavorite("artist", artist.id)} onClick={e => handleFavorite(e, "artist", artist.id, artist.name, "", artist.picture_xl, "itunes")} type="fav" size="lg" />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h2 style={{ fontSize: "1.4em", marginBottom: 4 }}>{artist.name}</h2>
              {artist.nb_fans > 0 && <p style={{ color: "var(--text3)", marginBottom: 8 }}>{artist.nb_fans.toLocaleString()} fans</p>}
              {/* Ítem 8: botones de portada en artista quitados */}
            </div>
          </div>
          {artist.albums?.length > 0 && (
            <div>
              <SectionHeader icon="" title={`Álbumes (${artist.nb_album || artist.albums.length})`} subtitle="" />
              <AlbumGrid albums={artist.albums} source="itunes" onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styled Components ──

function ActionBtn({ active, onClick, type, size = "md", pos }) {
  const sizes = { sm: 24, md: 28, lg: 34 };
  const s = sizes[size] || 28;
  const posStyle = pos === "top-right" ? { position: "absolute", top: 4, right: 4 } : {};
  if (type === "fav") {
    return (
      <button onClick={onClick} style={{ ...posStyle, background: active ? "rgba(239,68,68,0.9)" : "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: s, height: s, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width={s * 0.5} height={s * 0.5} viewBox="0 0 24 24" fill={active ? "#fff" : "none"} stroke="#fff" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
    );
  }
  return (
    <button onClick={onClick} style={{ ...posStyle, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: s, height: s, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={s * 0.5} height={s * 0.5} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  );
}


function ShareBtn({ onClick, saved, size = "md" }) {
  const sizes = { sm: 24, md: 28, lg: 34 };
  const s = sizes[size] || 28;
  return (
    <button onClick={onClick} style={{ background: saved ? "rgba(34,197,94,0.9)" : "rgba(0,0,0,0.6)", border: saved ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.15)", borderRadius: "50%", width: s, height: s, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s", boxShadow: saved ? "0 0 8px rgba(34,197,94,0.4)" : "none" }} title={saved ? "Ya disponible offline" : "Guardar para ver sin internet"}>
      {saved ? (
        <svg width={s * 0.45} height={s * 0.45} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width={s * 0.45} height={s * 0.45} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      )}
    </button>
  );
}

function DlBtn({ onClick, color, label, style }) {
  return (
    <button onClick={onClick} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: color, color: "#fff", fontSize: "0.78em", cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      {label}
    </button>
  );
}

function BackBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "0.9em", marginBottom: 15, padding: 0, display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Volver
    </button>
  );
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ color: "var(--text)", fontSize: "1.1em", marginBottom: 2 }}>{icon} {title}</h3>
      {subtitle && <p style={{ color: "var(--text5)", fontSize: "0.8em" }}>{subtitle}</p>}
    </div>
  );
}

function HorizontalAlbumRow({ albums, onSelect, onFavorite, onPlaylist, isFavorite, source }) {
  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ flex: "0 0 140px", background: "var(--panel)", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)", position: "relative" }}>
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2 }}>
            <ActionBtn active={isFavorite("album", a.id)} onClick={e => onFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="fav" size="sm" />
          </div>
          <div style={{ padding: "6px 8px" }}>
            <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "var(--text4)", fontSize: "0.68em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationRow({ favorites, onSelect, onFavorite, onPlaylist, isFavorite }) {
  // Show favorite albums as clickable cards
  const favAlbums = favorites.filter(f => f.item_type === "album").slice(0, 8);
  if (favAlbums.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
      {favAlbums.map(f => (
        <div key={f.id} onClick={() => onSelect(f.item_id, f.source || "itunes")} style={{ flex: "0 0 140px", background: "var(--panel)", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)" }}>
          {f.cover_url ? <img src={f.cover_url} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} /> : <div style={{ width: "100%", aspectRatio: 1, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>?</div>}
          <div style={{ padding: "6px 8px" }}>
            <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div style={{ color: "var(--text4)", fontSize: "0.68em" }}>{f.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AlbumGrid({ albums, source, onSelect, onFavorite, onPlaylist, isFavorite }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: 10 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "var(--panel)", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)", position: "relative", transition: "transform 0.15s" }}
          onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"} onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", top: 5, right: 5, display: "flex", gap: 3 }}>
            <ActionBtn active={isFavorite("album", a.id)} onClick={e => onFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="fav" size="sm" />
            <ActionBtn active={false} onClick={e => onPlaylist(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="add" size="sm" />
            <ShareBtn onClick={e => handleFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl || a.cover_medium, a.source || source)} saved={isFavorite("album", String(a.id))} size="sm" />
          </div>
          <div style={{ padding: "7px 9px" }}>
            <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "var(--text4)", fontSize: "0.68em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ source }) {
  return <div style={{ display: "inline-block", padding: "3px 9px", borderRadius: 6, fontSize: "0.72em", marginBottom: 12, background: source === "itunes" ? "#2e1a1a" : "#1a2e1a", color: source === "itunes" ? "#ef4444" : "#22c55e", border: `1px solid ${source === "itunes" ? "#4a2a2a" : "#2a4a2a"}` }}>{source === "itunes" ? "Apple Music" : source}</div>;
}

function ErrorMsg({ error }) {
  return <div style={{ background: "#2e1a1a", border: "1px solid #5a2a2a", borderRadius: 10, padding: 12, marginBottom: 12, color: "#ef4444", fontSize: "0.9em" }}>{error}</div>;
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 30, color: "var(--accent)" }}>Cargando...</div>;
}
