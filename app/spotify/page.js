"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";

export default function SpotifyPage() {
  const { user, favorites, isFavorite, toggleFavorite, checkSession } = useUser();
  const [playlistModal, setPlaylistModal] = useState(null);
  const [tab, setTab] = useState("discover"); // discover, search, url, itunes
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
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
  const [offlineMsg, setOfflineMsg] = useState("");
  const [savedOfflineIds, setSavedOfflineIds] = useState(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      return new Set(Object.keys(saved));
    } catch { return new Set(); }
  });

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

  // Mostrar mensaje temporal
  function showOfflineMsg(msg) {
    setOfflineMsg(msg);
    setTimeout(() => setOfflineMsg(""), 3000);
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
    const source = params.get("source") || "deezer";
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

  function playPreview(url, trackId, trackName, trackArtist, trackCover) {
    const audio = audioRef.current;
    if (!audio) return;
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
    audio.src = url;
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
        fetch("/api/music?action=search&q=top+hits+2025&source=itunes&entity=album&limit=10"),
        fetch("/api/music?action=search&q=new+release&source=itunes&entity=album&limit=10"),
        fetch("/api/music?action=search&q=latin+music+hits&source=itunes&entity=album&limit=10"),
      ]);
      const topData = await topRes.json();
      const newData = await newRes.json();
      const latData = await latRes.json();
      setCharts({
        top: topData.albums || [],
        newReleases: newData.albums || [],
        latin: latData.albums || [],
      });
    } catch {}
    setChartsLoading(false);
  }

  // Get recommendations based on user favorites
  function getRecommendations() {
    if (!favorites || favorites.length === 0) return [];
    // Use favorite artists/albums as search terms
    const terms = [...new Set(favorites.slice(0, 5).map(f => f.artist || f.name).filter(Boolean))];
    return terms;
  }

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setResults(null); setAlbum(null); setArtist(null);
    try {
      const res = await fetch("/api/music?action=search&q=" + encodeURIComponent(query) + "&source=auto&limit=20");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadAlbum(albumId, source = "deezer") {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try {
      const endpoint = source === "itunes"
        ? "/api/music?action=lookup&id=" + albumId + "&source=itunes"
        : "/api/music?action=album&id=" + albumId + "&source=deezer";
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
      const res = await fetch("/api/music?action=artist&id=" + artistId + "&source=deezer");
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
      // Se quitó el ❤️ → también eliminar del offline
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
      showOfflineMsg("💔 Eliminada de favoritos y offline");
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
      // Si es álbum, guardar todas las canciones
      if (itemType === "album" && album?.tracks) {
        const trackIds = [];
        for (let i = 0; i < album.tracks.length; i++) {
          const t = album.tracks[i];
          const tKey = String(t.id || `${itemId}-${i}`);
          if (t.preview_url) {
            try { if ("caches" in window) { const c = await caches.open("ml-saved-v1"); await c.add(t.preview_url); } } catch {}
          }
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
      const msg = itemType === "album" ? "❤️ Álbum guardado en favoritos y offline" : "❤️ Guardada en favoritos y offline";
      showOfflineMsg(msg);
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
      showOfflineMsg("🎵 Ya está disponible offline");
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
    showOfflineMsg(msg);
    addSavedOfflineId(itemId);
  }

  // ── Styles ──
  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };
  const BS = { padding: "10px 18px", borderRadius: 10, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "0.9em", cursor: "pointer", fontWeight: 600 };
  const TabS = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: active ? "#7c5cfc" : "#1a1a2e", color: active ? "#fff" : "#888", fontSize: "0.85em", cursor: "pointer", fontWeight: active ? 700 : 400 });

  const albums = results?.albums || [];
  const artists = results?.artists || [];
  const src = results?.source || "";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "15px 20px", minHeight: "100vh", position: "relative" }}>
      {playlistModal && <AddToPlaylistModal item={playlistModal} onClose={() => setPlaylistModal(null)} />}
      {/* Mensaje offline flotante */}
      {offlineMsg && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "rgba(34,197,94,0.95)", color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: "0.9em", fontWeight: 600, boxShadow: "0 4px 20px rgba(34,197,94,0.4)", zIndex: 9999, whiteSpace: "nowrap", animation: "fadeInUp 0.3s ease" }}>
          {offlineMsg}
          <style>{"@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}"}</style>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setTab("discover"); setAlbum(null); setArtist(null); setResults(null); }} style={TabS(tab === "discover" && !album && !artist)}>🌟 Descubrir</button>
        <button onClick={() => { setTab("search"); setAlbum(null); setArtist(null); }} style={TabS(tab === "search" && !album && !artist)}>Buscar</button>
        <button onClick={() => { setTab("url"); setAlbum(null); setArtist(null); }} style={TabS(tab === "url")}>URL Spotify</button>
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
              <SectionHeader icon="💜" title="Para ti" subtitle="Basado en tus favoritos" />
              <RecommendationRow favorites={favorites} onSelect={(id, src) => loadAlbum(id, src)} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
            </div>
          )}

          {/* Charts */}
          {chartsLoading ? (
            <div style={{ textAlign: "center", padding: 30, color: "#7c5cfc" }}>Cargando recomendaciones...</div>
          ) : charts && (
            <>
              {charts.latin?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon="🔥" title="Latin Hits" subtitle="Lo más escuchado" />
                  <HorizontalAlbumRow albums={charts.latin.slice(0, 8)} onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.newReleases?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon="✨" title="Nuevos lanzamientos" subtitle="Lo más reciente" />
                  <HorizontalAlbumRow albums={charts.newReleases.slice(0, 8)} onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} source="itunes" />
                </div>
              )}
              {charts.top?.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <SectionHeader icon="🌍" title="Top Global" subtitle="Los más populares" />
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
                      <div key={a.id} onClick={() => a.source === "deezer" ? loadArtist(a.id) : null} style={{ flex: "0 0 110px", background: "#1a1a2e", borderRadius: 12, padding: 10, textAlign: "center", cursor: "pointer", border: "1px solid #2a2a3e", position: "relative" }}>
                        <ActionBtn pos="top-right" active={isFavorite("artist", a.id)} onClick={e => handleFavorite(e, "artist", a.id, a.name, "", a.picture_medium, a.source || "deezer")} type="fav" />
                        {a.picture_medium ? <img src={a.picture_medium} style={{ width: 70, height: 70, borderRadius: "50%", objectFit: "cover", marginBottom: 6 }} /> : <div style={{ width: 70, height: 70, borderRadius: "50%", background: "#2a2a3e", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center" }}>?</div>}
                        <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
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
              {!loading && results && albums.length === 0 && artists.length === 0 && <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados</p>}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: URL ── */}
      {tab === "url" && !album && !artist && (
        <div>
          <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 15 }}>Pegá cualquier URL de Spotify (álbum, canción, playlist):</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 15, flexWrap: "wrap" }}>
            <input value={oembedUrl} onChange={e => setOembedUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && resolveOEmbed()} placeholder="https://open.spotify.com/album/..." style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={resolveOEmbed} disabled={loading} style={BS}>{loading ? "..." : "Obtener"}</button>
          </div>
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {oembedResult && !loading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 20, border: "1px solid #2a2a3e" }}>
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginBottom: 15 }}>
                <img src={oembedResult.thumbnail_large || oembedResult.thumbnail} style={{ width: 160, height: 160, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <h2 style={{ fontSize: "1.2em", marginBottom: 5 }}>{oembedResult.title}</h2>
                  <p style={{ color: "#1ed760", marginBottom: 10 }}>{oembedResult.provider}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {oembedResult.thumbnail_large && <DlBtn onClick={() => downloadImage(oembedResult.thumbnail_large, "cover_large.jpg")} color="#22c55e" label="Grande" />}
                    {oembedResult.thumbnail && <DlBtn onClick={() => downloadImage(oembedResult.thumbnail, "cover_thumb.jpg")} color="#3b82f6" label="Mini" />}
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
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
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
              {album.artist_id && album.source === "deezer" ? (
                <p style={{ color: "#1ed760", marginBottom: 4, cursor: "pointer" }} onClick={() => { setAlbum(null); loadArtist(album.artist_id); }}>{album.artist}</p>
              ) : <p style={{ color: "#1ed760", marginBottom: 4 }}>{album.artist}</p>}
              <p style={{ color: "#888", marginBottom: 2, fontSize: "0.9em" }}>{album.release_date || album.year} {album.total_tracks ? `— ${album.total_tracks} canciones` : ""} {album.track_count ? `— ${album.track_count} canciones` : ""}</p>
              {album.label && <p style={{ color: "#555", fontSize: "0.8em" }}>Sello: {album.label}</p>}
              {album.genre && <p style={{ color: "#555", fontSize: "0.8em" }}>Género: {album.genre}</p>}
              {album.images?.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {album.images.map((img, i) => (
                    <DlBtn key={i} onClick={() => downloadImage(img.url, album.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")} color={i === 0 ? "#22c55e" : "#3b82f6"} label={img.label || img.size} />
                  ))}
                </div>
              )}
              {(album.cover_xl || album.cover_big) && !album.images?.length && (
                <DlBtn onClick={() => downloadImage(album.cover_xl || album.cover_big, "cover.jpg")} color="#22c55e" label="Descargar portada" style={{ marginTop: 10 }} />
              )}
            </div>
          </div>
          {album.tracks?.length > 0 && (
            <div>
              <SectionHeader icon="" title="Canciones" subtitle="" />
              <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
                {album.tracks.map((track, i) => {
                  const trackKey = String(track.id || `${album.id}-${i}`);
                  const isPlaying = playingTrack === trackKey;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid #2a2a3e" }}>
                      <span style={{ color: "#555", width: 22, textAlign: "right", fontSize: "0.82em" }}>{track.number || i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#e0e0e0", fontSize: "0.9em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                        {track.artist && track.artist !== album.artist && <div style={{ color: "#666", fontSize: "0.75em" }}>{track.artist}</div>}
                      </div>
                      {track.duration && <span style={{ color: "#555", fontSize: "0.82em", flexShrink: 0 }}>{track.duration}</span>}
                      <ActionBtn active={isFavorite("track", trackKey)} onClick={e => handleFavorite(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source, { preview_url: track.preview_url || "", album_id: album.id || "" })} type="fav" size="sm" />
                      <ActionBtn active={false} onClick={e => handleAddToPlaylist(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source)} type="add" size="sm" />
                      <ShareBtn onClick={e => handleFavorite(e, "track", trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium, album.source, { preview_url: track.preview_url || "", album_id: album.id || "" })} saved={isFavorite("track", trackKey)} size="sm" />
                      {track.preview_url && (
                        <button onClick={() => playPreview(track.preview_url, trackKey, track.name, track.artist || album.artist, album.cover_xl || album.cover_big || album.cover_medium)} style={{ background: isPlaying ? "#7c5cfc" : "rgba(124,92,252,0.15)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <svg width="10" height="12" viewBox="0 0 10 12" fill={isPlaying ? "#fff" : "#7c5cfc"}>
                            {isPlaying ? <><rect x="0" y="1" width="3" height="10" rx="1"/><rect x="6" y="1" width="3" height="10" rx="1"/></> : <polygon points="0,0 10,6 0,12"/>}
                          </svg>
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
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 20, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              {artist.picture_xl ? <img src={artist.picture_xl} style={{ width: 150, height: 150, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} /> : <div style={{ width: 150, height: 150, borderRadius: "50%", background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3em" }}>?</div>}
              <div style={{ position: "absolute", bottom: 4, right: 4 }}>
                <ActionBtn active={isFavorite("artist", artist.id)} onClick={e => handleFavorite(e, "artist", artist.id, artist.name, "", artist.picture_xl, "deezer")} type="fav" size="lg" />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h2 style={{ fontSize: "1.4em", marginBottom: 4 }}>{artist.name}</h2>
              {artist.nb_fans > 0 && <p style={{ color: "#888", marginBottom: 8 }}>{artist.nb_fans.toLocaleString()} fans</p>}
              {artist.images?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {artist.images.map((img, i) => (
                    <DlBtn key={i} onClick={() => downloadImage(img.url, artist.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")} color={i === 0 ? "#22c55e" : "#3b82f6"} label={img.label || img.size} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {artist.albums?.length > 0 && (
            <div>
              <SectionHeader icon="" title={`Álbumes (${artist.nb_album || artist.albums.length})`} subtitle="" />
              <AlbumGrid albums={artist.albums} source="deezer" onSelect={(id) => loadAlbum(id, "deezer")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
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
    <button onClick={onClick} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", fontSize: "0.9em", marginBottom: 15, padding: 0, display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Volver
    </button>
  );
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ color: "#e0e0e0", fontSize: "1.1em", marginBottom: 2 }}>{icon} {title}</h3>
      {subtitle && <p style={{ color: "#555", fontSize: "0.8em" }}>{subtitle}</p>}
    </div>
  );
}

function HorizontalAlbumRow({ albums, onSelect, onFavorite, onPlaylist, isFavorite, source }) {
  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ flex: "0 0 140px", background: "#1a1a2e", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e", position: "relative" }}>
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2 }}>
            <ActionBtn active={isFavorite("album", a.id)} onClick={e => onFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="fav" size="sm" />
          </div>
          <div style={{ padding: "6px 8px" }}>
            <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.68em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
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
        <div key={f.id} onClick={() => onSelect(f.item_id, f.source || "deezer")} style={{ flex: "0 0 140px", background: "#1a1a2e", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e" }}>
          {f.cover_url ? <img src={f.cover_url} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} /> : <div style={{ width: "100%", aspectRatio: 1, background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>?</div>}
          <div style={{ padding: "6px 8px" }}>
            <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div style={{ color: "#666", fontSize: "0.68em" }}>{f.artist}</div>
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
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "#1a1a2e", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e", position: "relative", transition: "transform 0.15s" }}
          onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"} onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ position: "absolute", top: 5, right: 5, display: "flex", gap: 3 }}>
            <ActionBtn active={isFavorite("album", a.id)} onClick={e => onFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="fav" size="sm" />
            <ActionBtn active={false} onClick={e => onPlaylist(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} type="add" size="sm" />
            <ShareBtn onClick={e => handleFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl || a.cover_medium, a.source || source)} saved={isFavorite("album", String(a.id))} size="sm" />
          </div>
          <div style={{ padding: "7px 9px" }}>
            <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.68em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ source }) {
  return <div style={{ display: "inline-block", padding: "3px 9px", borderRadius: 6, fontSize: "0.72em", marginBottom: 12, background: source === "deezer" ? "#1a2e1a" : "#2e1a1a", color: source === "deezer" ? "#22c55e" : "#ef4444", border: `1px solid ${source === "deezer" ? "#2a4a2a" : "#4a2a2a"}` }}>{source === "deezer" ? "Deezer" : "iTunes"}</div>;
}

function ErrorMsg({ error }) {
  return <div style={{ background: "#2e1a1a", border: "1px solid #5a2a2a", borderRadius: 10, padding: 12, marginBottom: 12, color: "#ef4444", fontSize: "0.9em" }}>{error}</div>;
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 30, color: "#7c5cfc" }}>Cargando...</div>;
}
