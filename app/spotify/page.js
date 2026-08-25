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
  const { user, profile, favorites, isFavorite, toggleFavorite, checkSession } = useUser();
  const { enqueueAlbum } = useDownloads();
  const [playlistModal, setPlaylistModal] = useState(null);
  const [tab, setTab] = useState("discover"); // discover, search, url, itunes
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  /* Autocompletado mientras tecleás (estilo Spotify) */
  const [sugs, setSugs] = useState([]);
  const [showSugs, setShowSugs] = useState(false);
  const sugsTimerRef = useRef(null);
  function alTeclear(texto) {
    setQuery(texto);
    if (sugsTimerRef.current) clearTimeout(sugsTimerRef.current);
    if (!texto || texto.trim().length < 2) { setSugs([]); setShowSugs(false); return; }
    sugsTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/music?action=sugerir&q=" + encodeURIComponent(texto.trim()));
        const d = await r.json();
        setSugs(d.sugerencias || []);
        setShowSugs((d.sugerencias || []).length > 0);
      } catch {}
    }, 280);
  }
  function elegirSug(s) {
    setShowSugs(false); setSugs([]);
    if (s.tipo === "cancion" && s.album_id) {
      setQuery(s.texto);
      loadAlbum(s.album_id, s.source || "deezer", s.texto);
    } else {
      search(s.texto);
    }
  }
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
  /* Mini-reproductor de la sección Música */
  const [nowPlaying, setNowPlaying] = useState(null);   // {key,name,artist,cover}
  const [prevSonando, setPrevSonando] = useState(false);
  const [prevProg, setPrevProg] = useState(0);
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
    /* /spotify "suelto" (apps instaladas con el start_url viejo) salta
       a la app unificada conservando el destino (album/busqueda):
       así TODOS usan el reproductor global. */
    if (typeof window !== "undefined" && !window.__auraPlayerGlobal && window.location.pathname.startsWith("/spotify")) {
      try {
        const p0 = new URLSearchParams(window.location.search);
        const destino = {};
        if (p0.get("album")) {
          destino.album = p0.get("album");
          destino.source = p0.get("source") || "itunes";
          if (p0.get("track")) destino.track = p0.get("track");
        } else if (p0.get("buscar")) {
          destino.buscar = p0.get("buscar");
        }
        if (Object.keys(destino).length) localStorage.setItem("aura_explorar_destino", JSON.stringify(destino));
        localStorage.setItem("aura_vista", "explorar");
      } catch {}
      window.location.replace("/profile");
      return;
    }
    loadCharts();
    const params = new URLSearchParams(window.location.search);
    const albumId = params.get("album");
    const artistId = params.get("artist");
    const source = params.get("source") || "itunes";
    const buscarParam = params.get("buscar");
    const trackParam = params.get("track");
    if (albumId) loadAlbum(albumId, source, trackParam);
    else if (artistId) loadArtist(artistId);
    else if (buscarParam) { setTab("search"); search(buscarParam); }
    /* Destino pendiente (viene de Favoritos/Buzón dentro de la app
       unificada, sin recargar la página) */
    try {
      const dRaw = localStorage.getItem("aura_explorar_destino");
      if (dRaw) {
        localStorage.removeItem("aura_explorar_destino");
        const d = JSON.parse(dRaw);
        if (d.album) loadAlbum(d.album, d.source || "itunes", d.track || null);
        else if (d.buscar) { setTab("search"); search(d.buscar); }
      }
    } catch {}
  }, []);

  // Destinos en caliente (Explorar ya montado)
  useEffect(() => {
    const h = (e) => {
      const d = e.detail || {};
      if (d.album) loadAlbum(d.album, d.source || "itunes", d.track || null);
      else if (d.buscar) { setTab("search"); search(d.buscar); }
    };
    window.addEventListener("aura-explorar-destino", h);
    return () => window.removeEventListener("aura-explorar-destino", h);
  }, []);

  /* ── "Para ti" VIVO ──────────────────────────────────────────
     Semillas = los artistas que más se repiten en favoritos y
     descargas. Con ellas, el server busca artistas del mismo estilo
     (relacionados de Deezer) y trae sus álbumes. Cada canción que
     agregás puede cambiar las semillas → la sección se mueve sola. */
  /* "Seguir escuchando": lo último que sonó (de las stats locales).
     Tocar una la REPRODUCE al instante en el perfil. */
  const [recientes, setRecientes] = useState([]);
  const [sonandoGlobal, setSonandoGlobal] = useState(() =>
    (typeof window !== "undefined" && window.__auraSonando) || { key: null, playing: false });
  useEffect(() => {
    const h = (e) => setSonandoGlobal(e.detail || { key: null, playing: false });
    window.addEventListener("aura-sonando", h);
    return () => window.removeEventListener("aura-sonando", h);
  }, []);
  /* ¿Esta canción es la que está sonando en el reproductor global?
     Compara por clave exacta Y por nombre+artista normalizados, porque
     una misma canción puede vivir con claves distintas (id de iTunes,
     id de Deezer, clave de la descarga guardada...).
     OJO: los paréntesis SÍ cuentan — "(Radio Mix)", "(2009 Version)" son
     versiones DISTINTAS y antes se pintaban todas en verde a la vez.
     Solo ignoramos los de créditos: "(feat. X)", "(con X)". */
  const normCancion = (s) => String(s || "").toLowerCase()
    .replace(/[\(\[]\s*(feat|ft|with|con)\b[^\)\]]*[\)\]]/g, " ")
    .replace(/\b(feat|ft)\.?\s.*$/g, " ")
    .replace(/[^a-z0-9áéíóúüñ ]/g, " ")
    .replace(/\s+/g, " ").trim();
  function esLaQueSuena(trackKey, nombre, artistaNombre) {
    if (playingTrack === String(trackKey)) return true;
    const g = sonandoGlobal || {};
    if (!g.playing) return false;
    if (String(g.key) === String(trackKey)) return true;
    if (g.title && nombre && normCancion(g.title) === normCancion(nombre)) {
      if (!g.artist || !artistaNombre) return true;
      const a1 = normCancion(g.artist), a2 = normCancion(artistaNombre);
      return a1 === a2 || a1.includes(a2) || a2.includes(a1);
    }
    return false;
  }
  /* UNA sola fila ganadora EN TODA LA PANTALLA (ni dos en la misma
     lista, ni una en Canciones y otra en YouTube Music a la vez):
     - Si alguna sección tiene la CLAVE exacta de lo que suena, esa fila
       gana y las demás secciones no pintan nada.
     - El respaldo por nombre+artista solo se usa si NINGUNA sección
       reconoció la clave (p. ej. suena una descargada con otra clave). */
  function idxPorClave(lista, claveDe) {
    if (!lista || !lista.length) return -1;
    const g = sonandoGlobal || {};
    return lista.findIndex((x, j) => {
      const k = String(claveDe(x, j));
      return playingTrack === k || (g.playing && String(g.key) === k);
    });
  }
  function idxPorNombre(lista, nombreDe, artistaDe) {
    if (!lista || !lista.length) return -1;
    const g = sonandoGlobal || {};
    if (!g.playing || !g.title) return -1;
    return lista.findIndex((x, j) => {
      const n = nombreDe(x, j), a = artistaDe(x, j);
      if (!n || normCancion(g.title) !== normCancion(n)) return false;
      if (!g.artist || !a) return true;
      const a1 = normCancion(g.artist), a2 = normCancion(a);
      return a1 === a2 || a1.includes(a2) || a2.includes(a1);
    });
  }
  useEffect(() => {
    try {
      const st = JSON.parse(localStorage.getItem("aura_stats") || "{}");
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const arr = Object.entries(st)
        .map(([key, v]) => ({ key, ...v }))
        .filter(v => v && v.name && mp3s[v.key]?.audio_url)   // SOLO descargadas
        .sort((a, b) => (b.last || 0) - (a.last || 0))
        .slice(0, 8);
      setRecientes(arr);
    } catch {}
  }, []);
  /* Visor de una playlist del chart */
  const [plVista, setPlVista] = useState(null);
  const [guardandoPl, setGuardandoPl] = useState(false);
  /* Guardar la playlist del chart COMPLETA en "Mis playlists" */
  async function guardarPlaylistEnMias() {
    if (!plVista || plVista.cargando || guardandoPl) return;
    const tracks = plVista.tracks || [];
    if (!tracks.length) { toast.warning("La playlist está vacía", 2500); return; }
    setGuardandoPl(true);
    try {
      const r = await fetch("/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name: plVista.nombre || "Playlist", description: "Guardada desde Explorar" }) });
      const d = await r.json();
      if (!d.playlist) { toast.error(d.error || "No se pudo crear la playlist", 3500); setGuardandoPl(false); return; }
      /* TODAS las canciones en UN solo viaje (antes: una por una = eterno) */
      const res = await fetch("/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "add-items", playlist_id: d.playlist.id,
        items: tracks.map(t => ({
          item_type: "track", item_id: String(t.id || `${t.artist||""}-${t.name||""}`), name: t.name || "",
          artist: t.artist || "", cover_url: t.cover || "", source: "deezer",
          extra_data: { album_id: t.album_id || "", preview_url: t.preview_url || "", duration_ms: t.duration_ms || 0 },
        })),
      }) });
      const dd = await res.json();
      if (dd.agregados) toast.success(`"${plVista.nombre}" guardada en Mis playlists (${dd.agregados} canciones)`, 4000);
      else toast.warning(dd.error || "Se creó la playlist pero no se pudieron agregar las canciones", 4000);
    } catch { toast.error("Error de red", 3000); }
    setGuardandoPl(false);
  }
  async function abrirPlaylistChart(pl) {
    setPlVista({ nombre: pl.nombre, cover: pl.cover, tracks: [], cargando: true });
    try {
      const r = await fetch("/api/music?action=playlist&id=" + pl.id);
      const d = await r.json();
      setPlVista({ nombre: d.nombre || pl.nombre, cover: d.cover || pl.cover, tracks: d.tracks || [], cargando: false });
    } catch { setPlVista(v => v ? { ...v, cargando: false } : null); }
  }

  function seguirEscuchando(s) {
    /* Reproducir AQUÍ MISMO: el toque del usuario autoriza el audio al
       instante (navegar al perfil rompía el autoplay por política de iOS). */
    playPreview("", String(s.key), s.name, s.artist, s.cover, 0);
  }

  /* Canción a RESALTAR al abrir un álbum (desde búsqueda o favoritos):
     la fila se marca y la página baja sola hasta ella. */
  const [resaltada, setResaltada] = useState(null);
  const resaltadaRef = useRef(null);
  useEffect(() => {
    if (!album || !resaltada) return;
    const t = setTimeout(() => {
      try { resaltadaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [album, resaltada]);
  const [recs, setRecs] = useState(null);
  const [recsDe, setRecsDe] = useState([]);
  useEffect(() => {
    try {
      const conteo = new Map();
      const sumar = (nombre, peso) => {
        const n = (nombre || "").trim();
        if (!n) return;
        conteo.set(n, (conteo.get(n) || 0) + peso);
      };
      // Favoritos (los más nuevos pesan más)
      (favorites || []).forEach((f, i) => sumar(f.artist || (f.item_type === "artist" ? f.name : ""), 2 + Math.max(0, 10 - i) * 0.1));
      // Descargas
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      for (const e of Object.values(mp3s)) if (e && e.artist) sumar(e.artist, 3);
      const semillas = [...conteo.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);
      if (!semillas.length) { setRecs(null); return; }
      fetch("/api/music?action=recomendaciones&artistas=" + encodeURIComponent(semillas.join(",")))
        .then(r => r.json())
        .then(d => { setRecs(d.albums || []); setRecsDe(d.similares || []); })
        .catch(() => setRecs(null));
    } catch { setRecs(null); }
  }, [favorites]);

  // Single audio element for previews
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => { setPlayingTrack(null); setNowPlaying(null); if(navigator.mediaSession){ navigator.mediaSession.playbackState = "none"; navigator.mediaSession.metadata = null; } });
      audioRef.current.addEventListener("play", () => setPrevSonando(true));
      audioRef.current.addEventListener("pause", () => setPrevSonando(false));
      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current;
        if (a && a.duration > 0) setPrevProg((a.currentTime / a.duration) * 100);
      });
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
      setNowPlaying(null);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      return;
    }
    setNowPlaying({ key: trackId, name: trackName, artist: trackArtist, cover: trackCover });
    // Stop current and play new
    audio.pause();
    audio.currentTime = 0;
    
    /* ── REPRODUCTOR GLOBAL ────────────────────────────────────────
       Si Explorar vive dentro de la app unificada, la canción se manda
       al reproductor principal (el de Mi música): mini-barra, pantalla
       completa, karaoke, cola... todo en uno y sin cortes. */
    if (typeof window !== "undefined" && window.__auraPlayerGlobal) {
      let urlGlobal = url;
      try {
        const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
        const claves = [String(trackId), (trackArtist + " " + trackName).trim(), (trackName + " " + trackArtist).trim(), trackName.trim()];
        for (const k of claves) {
          if (mp3s[k]?.audio_url) { urlGlobal = mp3s[k].audio_url; break; }
        }
      } catch {}
      if (!urlGlobal) { toast.warning("Esta canción no tiene audio para reproducir", 3000); setNowPlaying(null); return; }
      window.dispatchEvent(new CustomEvent("aura-reproducir", { detail: {
        key: String(trackId),
        title: trackName || "",
        artist: trackArtist || "",
        cover_url: trackCover || "",
        audio_url: urlGlobal,
        duration_ms: trackDurMs || null,
      }}));
      setNowPlaying(null);
      return;
    }

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
      toast.success("Reproduciendo canción completa: " + trackName, 3000);
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

  async function loadCharts(refrescar) {
    setChartsLoading(true);
    try {
      /* Feed VIVO: charts y lanzamientos reales (Deezer los actualiza
         a diario). Con refrescar=true los géneros salen al azar. */
      const res = await fetch("/api/music?action=feed" + (refrescar ? "&r=" + Date.now() : ""));
      const d = await res.json();
      setCharts({
        top: d.top || [],
        newReleases: d.nuevos || [],
        latin: d.latin || [],
        momento: d.momento || [],
        generos: d.generos || [],
        playlists: d.playlists || [],
      });
    } catch {
      setCharts({ top: [], newReleases: [], latin: [], momento: [], generos: [], playlists: [] });
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
    setYtmResults([]);
    /* YT Music en PARALELO (no frena la búsqueda normal si tarda) */
    fetch("/api/music?action=ytmusic&q=" + encodeURIComponent(q))
      .then(r => r.json()).then(d => setYtmResults(d.canciones || [])).catch(() => {});
    try {
      const res = await fetch("/api/music?action=search&q=" + encodeURIComponent(q) + "&source=auto&limit=20&v=3");
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

  async function loadAlbum(albumId, source = "itunes", resaltar = null) {
    setResaltada(resaltar ? String(resaltar).toLowerCase().trim() : null);
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    /* Arrancar el álbum desde ARRIBA: si venías scrolleado hasta abajo
       (p. ej. desde Mi música o el feed), iOS se quedaba con el scroll
       hundido y el álbum largo "no dejaba bajar" (rebotaba). */
    try { window.scrollTo(0, 0); } catch {}
    try {
      const endpoint = source === "deezer"
        ? "/api/music?action=album&id=" + albumId + "&source=deezer&v=3"
        : "/api/music?action=lookup&id=" + albumId + "&source=itunes&v=3";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAlbum(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadArtist(artistId) {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try { window.scrollTo(0, 0); } catch {}
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

    if (wasFav) {
      await toggleFavorite(itemType, String(itemId), name, artistName, coverUrl, source, extraData);
      toast.info("Quitada de favoritos", 2200);
      return;
    }

    await toggleFavorite(itemType, String(itemId), name, artistName, coverUrl, source, extraData);

    try {
      const ar = await fetch("/api/pagos/acceso", { cache: "no-store" });
      const acceso = await ar.json();

      if (ar.ok && acceso.ilimitado) {
        if (itemType === "album" && album?.tracks) {
          enqueueAlbum(name, album.tracks.map((t, i) => ({
            key: String(t.id || `${itemId}-${i}`),
            name: t.name,
            artist: t.artist || artistName,
            cover: coverUrl,
            duration_ms: t.duration_ms || null
          })));
        } else {
          enqueueAlbum(name, [{
            key: String(itemId),
            name,
            artist: artistName,
            cover: coverUrl,
            duration_ms: extraData?.duration_ms || null
          }]);
        }

        toast.success("Guardada y descargando para usar offline", 3500);
      } else {
        if (itemType === "album" && album?.tracks) {
          enqueueAlbum(name, album.tracks.map((t, i) => ({
            key: String(t.id || `${itemId}-${i}`),
            name: t.name,
            artist: t.artist || artistName,
            cover: coverUrl,
            duration_ms: t.duration_ms || null,
            online_only: true
          })));
        } else {
          enqueueAlbum(name, [{
            key: String(itemId),
            name,
            artist: artistName,
            cover: coverUrl,
            duration_ms: extraData?.duration_ms || null,
            online_only: true
          }]);
        }

        toast.info("Guardada en favoritos y en Descargas online", 3000);
      }
    } catch {
      toast.info("Guardada en favoritos", 2200);
    }
  }

  function handleAddToPlaylist(e, itemType, itemId, name, artistName, coverUrl, source) {
    e.stopPropagation();
    setPlaylistModal({ item_type: itemType, item_id: String(itemId), name, artist: artistName, cover_url: coverUrl, source });
  }

  async function handleSaveOffline(e, itemType, itemId, name, artistName, source, sourceUrl, coverUrl) {
    e.stopPropagation();
    // El servidor es la autoridad; esta comprobación evita encolar una descarga bloqueada.
    try {
      const ar = await fetch("/api/pagos/acceso", { cache: "no-store" });
      const acceso = await ar.json();
      if (ar.ok && !acceso.ilimitado) {
        const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
        const unicas = new Set(Object.values(mp3s).filter(x => x?.audio_url).map(x => x.video_id || `${x.artist}|${x.name}`));
        if (!unicas.has(String(itemId)) && unicas.size >= 50) {
          toast.warning("Límite de 50 canciones offline. Actualiza a AURA Premium", 4500);
          return;
        }
      }
    } catch {}
    // Si ya está guardado offline, solo mostrar mensaje
    if (isSavedOffline(itemId)) {
      toast.info("Ya está disponible offline", 3000);
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
    // Descargar el audio completo solo al pulsar el botón de descarga.
    if (itemType === "album" && album?.tracks) {
      enqueueAlbum(name, album.tracks.map((t, i) => ({ key: String(t.id || `${itemId}-${i}`), name: t.name, artist: t.artist || artistName, cover: coverUrl, duration_ms: t.duration_ms || null })));
    } else {
      const track = album?.tracks?.find(t => String(t.id) === String(itemId) || t.name === name);
      enqueueAlbum(name, [{ key: String(itemId), name, artist: artistName, cover: coverUrl, duration_ms: track?.duration_ms || null }]);
    }
    const msg = itemType === "album" ? "Descargando álbum para usarlo offline" : "Descargando para usarla offline";
    toast.success(msg, 4000);
    addSavedOfflineId(itemId);
  }

  // ── Styles ──
  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text-strong)", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };
  const BS = { padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: "0.9em", cursor: "pointer", fontWeight: 600 };
  const TabS = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: active ? "var(--accent)" : "var(--panel)", color: active ? "#fff" : "var(--text3)", fontSize: "0.85em", cursor: "pointer", fontWeight: active ? 700 : 400 });

  const albums = results?.albums || [];
  const artists = results?.artists || [];
  const songResults = results?.songs || [];
  const [ytmResults, setYtmResults] = useState([]);
  /* Fila única sonando EN TODA LA PANTALLA (clave exacta manda) */
  const kCanciones = idxPorClave(songResults, s => s.id);
  const kYtm = idxPorClave(ytmResults, c => c.videoId);
  const kAlbum = album?.tracks?.length ? idxPorClave(album.tracks, (t, j) => t.id || `${album.id}-${j}`) : -1;
  const hayClaveExacta = kCanciones >= 0 || kYtm >= 0 || kAlbum >= 0;
  const idxCancionSonando = kCanciones >= 0 ? kCanciones : (hayClaveExacta ? -1 : idxPorNombre(songResults, s => s.name, s => s.artist));
  const idxAlbumSonando = kAlbum >= 0 ? kAlbum : ((hayClaveExacta || !album?.tracks?.length) ? -1 : idxPorNombre(album.tracks, t => t.name, t => t.artist || album.artist));
  /* Descargar una canción EXACTA de YT Music (por su video id) */
  function descargarYTM(c) {
    enqueueAlbum(c.title, [{
      key: String(c.videoId), name: c.title, artist: c.artist || "",
      cover: c.cover || "", duration_ms: (c.dur || 0) * 1000 || null,
      video_id: String(c.videoId),
    }]);
    toast.success("Descargando: " + c.title, 3000);
  }
  function reproducirYTM(c) {
    if (typeof window === "undefined") return;
    /* Si ya está descargada suena el archivo; si no, el video exacto
       por el reproductor global (necesita internet). */
    let audio = "";
    try {
      const s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      audio = s[String(c.videoId)]?.audio_url || "";
    } catch {}
    if (!audio) {
      /* Solo ESCUCHAR (streaming por YouTube): no le descargamos nada
         al usuario sin permiso. Para tenerla offline está el botón de
         descarga. Avisamos UNA vez por sesión que el streaming se pausa
         al salir de la app (regla de iOS con video). */
      try {
        if (!sessionStorage.getItem("aura_aviso_ytm")) {
          sessionStorage.setItem("aura_aviso_ytm", "1");
          toast.info("Sonando por YouTube: se pausa si sales de la app. Si la quieres con pantalla bloqueada y sin internet, descárgala con la flechita", 5000);
        }
      } catch {}
    }
    window.dispatchEvent(new CustomEvent("aura-reproducir", { detail: {
      key: String(c.videoId), title: c.title || "", artist: c.artist || "",
      cover_url: c.cover || "", audio_url: audio, video_id: String(c.videoId),
      duration_ms: (c.dur || 0) * 1000 || null,
    }}));
  }
  const src = results?.source || "";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", paddingTop: 15, paddingLeft: 20, paddingRight: 20, paddingBottom: nowPlaying ? "calc(95px + env(safe-area-inset-bottom))" : 15, minHeight: "100vh", position: "relative" }}>

      {/* ── Mini-reproductor de Música (canción completa o preview) ── */}
      {nowPlaying && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90, background: "linear-gradient(180deg, rgba(24,24,40,0.98), rgba(12,12,22,0.99))", borderTop: "1px solid rgba(124,92,252,0.18)", backdropFilter: "blur(20px)", boxShadow: "0 -8px 32px rgba(0,0,0,0.5)" }}>
          <div style={{ height: 2.5, background: "rgba(255,255,255,0.07)" }}>
            <div style={{ height: "100%", width: prevProg + "%", background: "linear-gradient(90deg,#22c55e,#4ade80)", transition: "width 0.25s linear" }} />
          </div>
          <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))" }}>
            {nowPlaying.cover ? <img src={nowPlaying.cover} style={{ width: 46, height: 46, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 46, height: 46, borderRadius: 8, background: "var(--border)", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#f0f0f0", fontSize: "0.88em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nowPlaying.name}</div>
              <div style={{ color: "#8a8a9a", fontSize: "0.74em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nowPlaying.artist}</div>
            </div>
            <button onClick={() => { const a = audioRef.current; if (!a) return; if (a.paused) { const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); } else a.pause(); }} style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", borderRadius: "50%", width: 46, height: 46, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 16px rgba(34,197,94,0.4)" }}>
              <Ico d={prevSonando ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></> : <polygon points="5 3 19 12 5 21 5 3"/>} size={18} stroke="#fff" fill="#fff" />
            </button>
            <button onClick={() => { const a = audioRef.current; if (a) { try { a.pause(); a.currentTime = 0; } catch {} } setPlayingTrack(null); setNowPlaying(null); }} title="Cerrar" style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", color: "#8a8a9a", fontSize: "0.9em", flexShrink: 0 }}>✕</button>
          </div>
        </div>
      )}
      {playlistModal && <AddToPlaylistModal item={playlistModal} onClose={() => setPlaylistModal(null)} />}

      {/* Visor de playlist del chart */}
      {plVista && (
        <div onClick={() => setPlVista(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 20, paddingLeft: 20, paddingRight: 20, paddingBottom: sonandoGlobal.key ? "calc(115px + env(safe-area-inset-bottom))" : 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, width: "100%", maxWidth: 440, maxHeight: sonandoGlobal.key ? "calc(100dvh - 165px)" : "78vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              {plVista.cover ? <img src={plVista.cover} style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} /> : null}
              <div style={{ flex: 1, minWidth: 0, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{plVista.nombre}</div>
              <button onClick={() => setPlVista(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: "1.2em", flexShrink: 0 }}>✕</button>
            </div>
            {/* Guardarla completa en Mis playlists */}
            {!plVista.cargando && (plVista.tracks || []).length > 0 && (
              <button onClick={guardarPlaylistEnMias} disabled={guardandoPl} style={{ width: "100%", marginBottom: 12, padding: "10px 14px", borderRadius: 10, border: "none", background: guardandoPl ? "var(--panel2)" : "var(--accent)", color: guardandoPl ? "var(--text3)" : "#fff", fontSize: "0.85em", fontWeight: 700, cursor: guardandoPl ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="14" y2="18"/><line x1="18" y1="15" x2="18" y2="21"/><line x1="15" y1="18" x2="21" y2="18"/></>} size={15} stroke={guardandoPl ? "var(--text3)" : "#fff"} />
                {guardandoPl ? "Guardando..." : "Agregar a Mis playlists"}
              </button>
            )}
            {plVista.cargando ? <p style={{ color: "var(--text4)", textAlign: "center", padding: 20 }}>Cargando...</p> :
              plVista.tracks.map((t, i) => (
                <div key={i} onClick={() => { setPlVista(null); if (t.album_id) loadAlbum(t.album_id, "deezer", t.name); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--border2)", cursor: "pointer" }}>
                  <span style={{ color: "var(--text5)", width: 20, textAlign: "center", fontSize: "0.75em", flexShrink: 0 }}>{i + 1}</span>
                  {t.cover ? <img src={t.cover} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} loading="lazy" /> : <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--border)", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "var(--text)", fontSize: "0.85em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ color: "var(--text4)", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setTab("discover"); setAlbum(null); setArtist(null); setResults(null); setQuery(""); setError(""); }} style={TabS(tab === "discover" && !album && !artist)}><Ico d={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />} size={16} stroke="currentColor" fill="currentColor" /> Descubrir</button>
        <button onClick={() => { setTab("search"); setAlbum(null); setArtist(null); }} style={TabS(tab === "search" && !album && !artist)}>Buscar</button>
      </div>

      {/* ── TAB: Discover ── */}
      {tab === "discover" && !album && !artist && (
        <div>
          {/* Quick search */}
          <div style={{ display: "flex", gap: 8, marginBottom: 25, flexWrap: "wrap" }}>
            {/* Tocar la barra te lleva DIRECTO a Buscar */}
            <input value={query} onFocus={() => setTab("search")} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas..." style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={() => { setTab("search"); search(); }} disabled={loading} style={BS}>{loading ? "..." : "Buscar"}</button>
          </div>

          {/* Saludo + refrescar */}
          <div style={{ marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "1.35em", fontWeight: 800, color: "var(--text-strong)" }}>
              {(() => { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; })()}{profile?.display_name || profile?.username ? ", " + (profile.display_name || profile.username) : ""}
            </div>
            <div style={{ color: "var(--text4)", fontSize: "0.85em", marginTop: 2 }}>{(typeof window !== "undefined" && localStorage.getItem("aura_sin_datos") === "1") ? "Modo sin datos activo · usando lo descargado" : "Esto está sonando hoy"}</div>
            </div>
            <button onClick={() => loadCharts(true)} title="Refrescar el feed" disabled={chartsLoading} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "50%", width: 40, height: 40, cursor: chartsLoading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: chartsLoading ? 0.85 : 1 }}>
              {/* Gira mientras el feed se refresca: se VE que está trabajando */}
              <span style={{ display: "flex", animation: chartsLoading ? "girar 0.7s linear infinite" : "none" }}>
                <Ico d={<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>} size={17} stroke="var(--accent)" />
              </span>
            </button>
          </div>

          {/* Chips de mood: búsqueda al toque */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 20, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
            {[["Fiesta", "fiesta reggaeton hits"], ["Chill", "chill relax acoustic"], ["Gym", "gym workout motivation"], ["Corazón roto", "sad canciones para llorar"], ["Road trip", "road trip classics"], ["Noventas", "90s hits"]].map(([et, q]) => (
              <button key={et} onClick={() => { setTab("search"); search(q); }} style={{ flexShrink: 0, padding: "8px 16px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text2)", fontSize: "0.82em", fontWeight: 700, cursor: "pointer" }}>{et}</button>
            ))}
          </div>

          {/* Seguir escuchando: un toque y sigue sonando */}
          {recientes.length > 0 && (
            <div style={{ marginBottom: 30 }}>
              <SectionHeader icon={<Ico d={<><polygon points="5 3 19 12 5 21 5 3"/></>} size={18} stroke="#22c55e" fill="#22c55e" />} title="Seguir escuchando" subtitle="Retomá donde quedaste" />
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
                {recientes.map(s => {
                  const sonando = esLaQueSuena(s.key, s.name, s.artist);
                  return (
                  <div key={s.key} onClick={() => seguirEscuchando(s)} style={{ flex: "0 0 200px", width: 200, minWidth: 0, maxWidth: 200, display: "flex", alignItems: "center", gap: 9, background: sonando ? "rgba(34,197,94,0.12)" : "var(--panel)", border: sonando ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border)", borderRadius: 10, padding: 8, cursor: "pointer" }}>
                    {s.cover ? <img src={s.cover} style={{ width: 44, height: 44, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} loading="lazy" /> : <div style={{ width: 44, height: 44, borderRadius: 7, background: "var(--border)", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: sonando ? "#22c55e" : "var(--text)", fontSize: "0.8em", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                      <div style={{ color: "var(--text4)", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.artist}</div>
                    </div>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: sonando ? "#22c55e" : "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Ico d={sonando ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></> : <polygon points="5 3 19 12 5 21 5 3"/>} size={12} stroke="#fff" fill="#fff" />
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Para ti: artistas del mismo estilo que lo que escuchás */}
          {recs && recs.length > 0 ? (
            <div style={{ marginBottom: 30 }}>
              <SectionHeader icon={<Ico d={<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />} size={18} stroke="#ec4899" fill="#ec4899" />} title="Para ti" subtitle={recsDe.length ? "Porque escuchás estilos como " + recsDe.slice(0, 3).join(", ") : "Artistas de tu estilo"} />
              <HorizontalAlbumRow albums={recs} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
            </div>
          ) : favorites.length > 0 && (
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
              {charts.momento?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>} size={18} stroke="#22c55e" />} title="Éxitos del momento" subtitle="El top mundial de hoy" />
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
                    {charts.momento.map((s, i) => (
                      <div key={s.id} onClick={() => loadAlbum(s.album_id, "deezer", s.name)} style={{ flex: "0 0 120px", width: 120, minWidth: 0, maxWidth: 120, overflow: "hidden", cursor: "pointer" }}>
                        <div style={{ position: "relative" }}>
                          {s.cover ? <img src={s.cover} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", borderRadius: 10, display: "block" }} loading="lazy" /> : <div style={{ width: "100%", aspectRatio: 1, borderRadius: 10, background: "var(--border)" }} />}
                          <span style={{ position: "absolute", top: 6, left: 6, background: "rgba(8,10,14,0.8)", color: "#22c55e", fontWeight: 800, fontSize: "0.68em", padding: "2px 7px", borderRadius: 6 }}>#{i + 1}</span>
                        </div>
                        <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div style={{ color: "var(--text4)", fontSize: "0.68em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.artist}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {charts.playlists?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>} size={18} stroke="#ec4899" />} title="Playlists del momento" subtitle="Las listas que el mundo escucha" />
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
                    {charts.playlists.map(pl => (
                      <div key={pl.id} onClick={() => abrirPlaylistChart(pl)} style={{ flex: "0 0 130px", width: 130, minWidth: 0, maxWidth: 130, overflow: "hidden", cursor: "pointer" }}>
                        {pl.cover ? <img src={pl.cover} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", borderRadius: 10, display: "block" }} loading="lazy" /> : <div style={{ width: "100%", aspectRatio: 1, borderRadius: 10, background: "var(--border)" }} />}
                        <div style={{ color: "var(--text2)", fontSize: "0.78em", fontWeight: 600, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.nombre}</div>
                        <div style={{ color: "var(--text4)", fontSize: "0.68em" }}>{pl.canciones} canciones</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {favorites.filter(f => f.item_type === "album").length > 2 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />} size={18} stroke="#ef4444" />} title="De tus favoritos" subtitle="Un recorrido por lo tuyo" />
                  <HorizontalAlbumRow albums={[...favorites.filter(f => f.item_type === "album")].sort(() => Math.random() - 0.5).slice(0, 8).map(f => ({ id: f.item_id, name: f.name, artist: f.artist, cover_medium: f.cover_url, cover_big: f.cover_url, source: f.source || "itunes" }))} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.latin?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<path d="M12 2s4 4 4 9a4 4 0 0 1-8 0c0-1 .5-2 1-3-2 1-4 3-4 6a6 6 0 0 0 12 0c0-5-5-9-5-9z" />} size={18} stroke="#f97316" fill="#f97316" />} title="Latin Hits" subtitle="Lo más escuchado" />
                  <HorizontalAlbumRow albums={charts.latin.slice(0, 8)} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.newReleases?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></>} size={18} stroke="#fbbf24" fill="#fbbf24" />} title="Nuevos lanzamientos" subtitle="Lo más reciente" />
                  <HorizontalAlbumRow albums={charts.newReleases.slice(0, 8)} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.top?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z" /></>} size={18} stroke="#38bdf8" />} title="Top Global" subtitle="Los más populares" />
                  <HorizontalAlbumRow albums={charts.top.slice(0, 8)} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {(charts.generos || []).map(g => (
                <div key={g.nombre} style={{ marginBottom: 30 }}>
                  <SectionHeader icon={<Ico d={<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={18} stroke="var(--accent)" />} title={g.nombre} subtitle="Lo mejor del género hoy" />
                  <HorizontalAlbumRow albums={g.albums.slice(0, 8)} onSelect={(id, s2) => loadAlbum(id, s2 || "deezer")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="deezer" />
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Search ── */}
      {tab === "search" && !album && !artist && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <input autoFocus value={query} onChange={e => alTeclear(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setShowSugs(false); search(); } }} onBlur={() => setTimeout(() => setShowSugs(false), 250)} placeholder="Buscar álbumes, artistas... (ej: Bad Bunny, Rosalía)" style={{ ...IS, paddingRight: 38 }} />
              {/* Dropdown de sugerencias en vivo */}
              {showSugs && sugs.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", zIndex: 50, boxShadow: "0 14px 40px rgba(0,0,0,0.45)" }}>
                  {sugs.map((s, i) => (
                    <div key={i} onMouseDown={(e) => { e.preventDefault(); elegirSug(s); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--border2)", cursor: "pointer" }}>
                      {s.cover
                        ? <img src={s.cover} style={{ width: 34, height: 34, borderRadius: s.tipo === "artista" ? "50%" : 6, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 34, height: 34, borderRadius: s.tipo === "artista" ? "50%" : 6, background: "var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Ico d={s.tipo === "artista" ? <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></> : <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>} size={15} stroke="var(--text4)" />
                          </div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "var(--text)", fontSize: "0.88em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.texto}</div>
                        <div style={{ color: "var(--text4)", fontSize: "0.7em" }}>{s.tipo === "artista" ? "Artista" : "Canción" + (s.sub ? " · " + s.sub : "")}</div>
                      </div>
                      <Ico d={<polyline points="9 18 15 12 9 6"/>} size={13} stroke="var(--text5)" />
                    </div>
                  ))}
                </div>
              )}
              {/* X para limpiar al instante */}
              {query && (
                <button onClick={() => { setQuery(""); setResults(null); setError(""); setSugs([]); setShowSugs(false); }} aria-label="Limpiar" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 30, height: 30, borderRadius: "50%", border: "none", background: "var(--border)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85em", fontWeight: 700 }}>✕</button>
              )}
            </div>
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
              {songResults.length > 0 && (
                <div style={{ marginBottom: 25 }}>
                  <SectionHeader icon="" title="Canciones" subtitle="" />
                  <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    {songResults.map((s, iFila) => {
                      const sonando = iFila === idxCancionSonando;
                      return (
                      <div key={s.id} onClick={() => loadAlbum(s.album_id, s.source || "itunes", s.name)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderBottom: "1px solid var(--border2)", cursor: "pointer", background: sonando ? "rgba(34,197,94,0.12)" : "transparent", borderLeft: sonando ? "3px solid #22c55e" : "3px solid transparent" }}>
                        {s.cover ? <img src={s.cover} style={{ width: 42, height: 42, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 42, height: 42, borderRadius: 7, background: "var(--border)", flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: sonando ? "#22c55e" : "var(--text)", fontSize: "0.88em", fontWeight: sonando ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                          <div style={{ color: "var(--text4)", fontSize: "0.73em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.artist}{s.album ? " · " + s.album : ""}</div>
                        </div>
                        {s.preview_url && (
                          <button onClick={(e) => { e.stopPropagation(); playPreview(s.preview_url, s.id, s.name, s.artist, s.cover, s.duration_ms); }} style={{ background: sonando ? "#22c55e" : "rgba(124,92,252,0.15)", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Ico d={sonando ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></> : <polygon points="5 3 19 12 5 21 5 3"/>} size={13} stroke="#fff" fill="#fff" />
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {ytmResults.length > 0 && (
                <div style={{ marginBottom: 25 }}>
                  <SectionHeader icon={<Ico d={<><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></>} size={18} stroke="#ef4444" />} title="YouTube Music" subtitle="Descarga exacta: baja justo esa versión" />
                  <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    {ytmResults.map(c => {
                      /* Aquí el match es por ID EXACTO del video (nada de
                         nombre+artista): dos versiones de la misma canción
                         se marcaban las dos a la vez */
                      const sonando = playingTrack === String(c.videoId) || (String(sonandoGlobal.key) === String(c.videoId) && sonandoGlobal.playing);
                      const off = hasFullMp3(String(c.videoId), c.title, c.artist || "");
                      return (
                      <div key={c.videoId} onClick={() => reproducirYTM(c)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderBottom: "1px solid var(--border2)", cursor: "pointer", background: sonando ? "rgba(34,197,94,0.12)" : "transparent", borderLeft: sonando ? "3px solid #22c55e" : "3px solid transparent" }}>
                        {c.cover ? <img src={c.cover} style={{ width: 42, height: 42, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 42, height: 42, borderRadius: 7, background: "var(--border)", flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: sonando ? "#22c55e" : "var(--text)", fontSize: "0.88em", fontWeight: sonando ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                          <div style={{ color: "var(--text4)", fontSize: "0.73em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.artist}{c.album ? " · " + c.album : ""}{c.dur ? " · " + Math.floor(c.dur / 60) + ":" + String(c.dur % 60).padStart(2, "0") : ""}</div>
                        </div>
                        {off && <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: "0.6em", fontWeight: 700, flexShrink: 0, background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>OFF</span>}
                        {!off && (
                          <button onClick={(e) => { e.stopPropagation(); descargarYTM(c); }} title="Descargar esta versión exacta" style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Ico d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>} size={14} stroke="#22c55e" />
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); reproducirYTM(c); }} style={{ background: sonando ? "#22c55e" : "rgba(124,92,252,0.15)", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Ico d={sonando ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></> : <polygon points="5 3 19 12 5 21 5 3"/>} size={13} stroke="#fff" fill="#fff" />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {albums.length > 0 && (
                <div>
                  <SectionHeader icon="" title="Álbumes" subtitle="" />
                  <AlbumGrid albums={albums} source={src} onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
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
                <ShareBtn onClick={e => handleSaveOffline(e, "album", album.id, album.name, album.artist, album.source, "", album.cover_xl || album.cover_big)} saved={isSavedOffline(album.id)} size="lg" />
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
                  const isPlaying = i === idxAlbumSonando;
                  const nombreBajo = (track.name || "").toLowerCase().trim();
                  const esResaltada = Boolean(resaltada && (nombreBajo === resaltada || nombreBajo.includes(resaltada) || resaltada.includes(nombreBajo)));
                  const tocar = () => { if (track.preview_url) playPreview(track.preview_url, trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, track.duration_ms || 0); };
                  return (
                    <div key={i} ref={esResaltada ? (el) => { resaltadaRef.current = el; } : undefined}
                      onClick={tocar}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)",
                        cursor: track.preview_url ? "pointer" : "default",
                        background: isPlaying ? "rgba(34,197,94,0.12)" : esResaltada ? "rgba(124,92,252,0.14)" : "transparent",
                        borderLeft: isPlaying ? "3px solid #22c55e" : esResaltada ? "3px solid var(--accent)" : "3px solid transparent",
                        transition: "background 0.3s" }}>
                      <span style={{ color: "var(--text5)", width: 22, textAlign: "right", fontSize: "0.82em" }}>{track.number || i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: isPlaying ? "#22c55e" : "var(--text)", fontSize: "0.9em", fontWeight: isPlaying ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                        {track.artist && track.artist !== album.artist && <div style={{ color: "var(--text4)", fontSize: "0.75em" }}>{track.artist}</div>}
                      </div>
                      {track.duration && <span style={{ color: "var(--text5)", fontSize: "0.82em", flexShrink: 0 }}>{track.duration}</span>}
                      <ActionBtn active={isFavorite("track", trackKey)} onClick={e => handleFavorite(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source, { preview_url: track.preview_url || "", album_id: album.id || "", duration_ms: track.duration_ms || 0 })} type="fav" size="sm" />
                      <ActionBtn active={false} onClick={e => handleAddToPlaylist(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source)} type="add" size="sm" />
                      <ShareBtn onClick={e => handleSaveOffline(e, "track", trackKey, track.name, track.artist || album.artist, album.source, "", album.cover_xl || album.cover_big || album.cover_medium)} saved={isSavedOffline(trackKey)} size="sm" />

                      {track.preview_url && (
                        <button onClick={(e) => { e.stopPropagation(); tocar(); }} style={{ background: isPlaying ? "#22c55e" : hasFullMp3(trackKey, track.name, track.artist || album.artist) ? "rgba(34,197,94,0.2)" : "rgba(124,92,252,0.15)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
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
              <AlbumGrid albums={artist.albums} source="itunes" onSelect={(id, s2) => loadAlbum(id, s2 || "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
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
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id, a.source || source)} style={{ flex: "0 0 140px", background: "var(--panel)", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)", position: "relative" }}>
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
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20 }}>
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
        <div key={a.id} onClick={() => onSelect(a.id, a.source || source)} style={{ background: "var(--panel)", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)", position: "relative", transition: "transform 0.15s" }}
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
