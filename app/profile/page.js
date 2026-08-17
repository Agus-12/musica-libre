"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";

// YouTube IFrame API loader
let ytApiLoaded = false;
let ytApiPromise = null;
function loadYTAPI() {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => { ytApiLoaded = true; resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    setTimeout(() => { if (!ytApiLoaded) { ytApiLoaded = true; resolve(); } }, 5000);
  });
  return ytApiPromise;
}

export default function ProfilePage() {
  const { user, profile, favorites, playlists, loading, isFavorite, toggleFavorite, loadFavorites, loadPlaylists, checkSession } = useUser();
  const [tab, setTab] = useState("downloads");
  const [favType, setFavType] = useState("album");
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [downloadingItems, setDownloadingItems] = useState({});
  const toast = useToast();

  // Player state
  const [playingKey, setPlayingKey] = useState(null);
  const [playingTitle, setPlayingTitle] = useState("");
  const [playingArtist, setPlayingArtist] = useState("");
  const [playingCover, setPlayingCover] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const playerRef = useRef(null);
  const playerDivRef = useRef(null);
  const progressRef = useRef(null);

  // Load downloaded music from localStorage
  const [downloadedMusic, setDownloadedMusic] = useState([]);

  function refreshDownloads() {
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const offline = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const items = [];
      for (const [key, entry] of Object.entries(mp3s)) {
        if (!entry.video_id && !entry.apple_url && !entry.audio_url) continue;
        let coverUrl = "";
        let artistName = "";
        let trackName = entry.title || key;
        const offlineEntry = offline[key];
        if (offlineEntry) {
          coverUrl = offlineEntry.cover_url || "";
          artistName = offlineEntry.artist || "";
          trackName = offlineEntry.name || trackName;
        }
        if (!coverUrl) {
          const favMatch = favorites.find(f => {
            const keys = [String(f.item_id), (f.artist + " " + f.name).trim(), (f.name + " " + f.artist).trim(), f.name.trim()];
            return keys.includes(key);
          });
          if (favMatch) {
            coverUrl = favMatch.cover_url || "";
            artistName = favMatch.artist || "";
            trackName = favMatch.name || trackName;
          }
        }
        items.push({
          key,
          title: trackName,
          artist: artistName,
          cover_url: coverUrl,
          video_id: entry.video_id || "",
          audio_url: entry.audio_url || "",
          apple_url: entry.apple_url || "",
          method: entry.method || (entry.video_id ? "youtube" : entry.audio_url ? "youtube" : "aaplmusicdownloader"),
          saved_at: entry.saved_at || 0,
        });
      }
      items.sort((a, b) => b.saved_at - a.saved_at);
      setDownloadedMusic(items);
    } catch {
      setDownloadedMusic([]);
    }
  }

  useEffect(() => { refreshDownloads(); }, [favorites]);

  // Initialize YouTube API
  useEffect(() => {
    loadYTAPI();
  }, []);

  // Progress tracking interval
  useEffect(() => {
    if (isPlaying && playerRef.current) {
      progressRef.current = setInterval(() => {
        try {
          const t = playerRef.current.getCurrentTime();
          const d = playerRef.current.getDuration();
          setCurrentTime(t || 0);
          setDuration(d || 0);
          setProgress(d > 0 ? (t / d) * 100 : 0);
        } catch {}
      }, 500);
    } else {
      if (progressRef.current) clearInterval(progressRef.current);
    }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [isPlaying]);

  async function playDownloaded(item) {
    // If same song, toggle play/pause
    if (playingKey === item.key && playerRef.current) {
      try {
        const state = playerRef.current.getPlayerState();
        if (state === 1) { // playing
          playerRef.current.pauseVideo();
          setIsPlaying(false);
          return;
        } else {
          playerRef.current.playVideo();
          setIsPlaying(true);
          return;
        }
      } catch {}
    }

    // Need a video_id to play
    if (!item.video_id) {
      // Try to find it via search
      toast.download("🔍 Buscando en YouTube: " + item.title, 3000);
      try {
        const searchQuery = (item.artist + " " + item.title).trim() || item.key;
        const res = await fetch("/api/download-mp3?q=" + encodeURIComponent(searchQuery));
        const data = await res.json();
        if (data.video_id) {
          // Save video_id for next time
          try {
            const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
            saved[item.key] = { ...saved[item.key], video_id: data.video_id, saved_at: Date.now() };
            localStorage.setItem("ml_mp3", JSON.stringify(saved));
          } catch {}
          item.video_id = data.video_id;
          refreshDownloads();
        } else {
          toast.error("❌ No se encontró en YouTube", 3000);
          if (item.apple_url) {
            toast.info("🍎 Podés descargarla desde aaplmusicdownloader.com", 4000);
          }
          return;
        }
      } catch {
        toast.error("❌ Error buscando en YouTube", 3000);
        return;
      }
    }

    // Stop current player
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    }

    setPlayingKey(item.key);
    setPlayingTitle(item.title);
    setPlayingArtist(item.artist);
    setPlayingCover(item.cover_url);
    setIsPlaying(false);
    setPlayerReady(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);

    // Wait for YT API
    await loadYTAPI();

    // Create a fresh div for the player
    const container = document.getElementById("yt-player-container");
    if (container) container.innerHTML = "";

    try {
      playerRef.current = new window.YT.Player("yt-player-container", {
        videoId: item.video_id,
        height: "1",
        width: "1",
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          playsinline: 1,
        },
        events: {
          onReady: (event) => {
            setPlayerReady(true);
            event.target.playVideo();
            setIsPlaying(true);
            const d = event.target.getDuration();
            setDuration(d || 0);
            toast.success("🎵 Reproduciendo: " + item.title, 3000);

            // Media Session
            if ("mediaSession" in navigator) {
              const artworkSrc = item.cover_url ? "/api/proxy?url=" + encodeURIComponent(item.cover_url) : "";
              try {
                navigator.mediaSession.metadata = new MediaMetadata({
                  title: item.title || "Canción",
                  artist: item.artist || "",
                  album: "",
                  artwork: artworkSrc ? [
                    { src: artworkSrc, sizes: "96x96", type: "image/jpeg" },
                    { src: artworkSrc, sizes: "256x256", type: "image/jpeg" },
                    { src: artworkSrc, sizes: "512x512", type: "image/jpeg" },
                  ] : [],
                });
              } catch {}
              navigator.mediaSession.playbackState = "playing";
              navigator.mediaSession.setActionHandler("play", () => {
                if (playerRef.current) playerRef.current.playVideo();
                setIsPlaying(true);
                navigator.mediaSession.playbackState = "playing";
              });
              navigator.mediaSession.setActionHandler("pause", () => {
                if (playerRef.current) playerRef.current.pauseVideo();
                setIsPlaying(false);
                navigator.mediaSession.playbackState = "paused";
              });
              try { navigator.mediaSession.setActionHandler("stop", () => {
                if (playerRef.current) playerRef.current.stopVideo();
                setIsPlaying(false);
                navigator.mediaSession.playbackState = "none";
                setPlayingKey(null);
              }); } catch {}
              try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
              try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
            }
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === 0) { // ENDED
              setIsPlaying(false);
              setPlayingKey(null);
              if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
            } else if (state === 1) { // PLAYING
              setIsPlaying(true);
            } else if (state === 2) { // PAUSED
              setIsPlaying(false);
            }
          },
          onError: (event) => {
            toast.error("❌ Error reproduciendo el video", 3000);
            setPlayingKey(null);
            setIsPlaying(false);
          },
        },
      });
    } catch (e) {
      toast.error("❌ No se pudo crear el player", 3000);
      setPlayingKey(null);
    }
  }

  function stopPlayback() {
    if (playerRef.current) {
      try { playerRef.current.stopVideo(); } catch {}
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    }
    setPlayingKey(null);
    setIsPlaying(false);
    setPlayingTitle("");
    setPlayingArtist("");
    setPlayingCover("");
    setProgress(0);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
    }
  }

  async function reDownload(item) {
    setDownloadingItems(prev => ({ ...prev, [item.key]: true }));
    toast.download("🔍 Buscando: " + item.title, 3000);
    try {
      const searchQuery = (item.artist + " " + item.title).trim() || item.key;
      const res = await fetch("/api/download-mp3?q=" + encodeURIComponent(searchQuery));
      const data = await res.json();
      if (data.video_id) {
        try {
          const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
          saved[item.key] = { ...saved[item.key], video_id: data.video_id, saved_at: Date.now() };
          localStorage.setItem("ml_mp3", JSON.stringify(saved));
        } catch {}
        toast.success("✅ Encontrada: " + item.title, 4000);
        refreshDownloads();
      } else {
        toast.warning("⚠️ No se encontró en YouTube", 4000);
      }
    } catch {
      toast.error("❌ Error buscando", 3000);
    }
    setDownloadingItems(prev => ({ ...prev, [item.key]: false }));
  }

  async function deleteDownload(item) {
    try {
      const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      delete saved[item.key];
      localStorage.setItem("ml_mp3", JSON.stringify(saved));
      if (item.audio_url && "caches" in window) {
        try { const cache = await caches.open("ml-saved-v1"); await cache.delete(item.audio_url); } catch {}
      }
      if (playingKey === item.key) stopPlayback();
      toast.success("🗑️ Eliminada: " + item.title, 3000);
      refreshDownloads();
    } catch {}
  }

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#7c5cfc" }}>Cargando...</div>;

  const filteredFavs = favorites.filter(f => f.item_type === favType);

  async function openPlaylist(pl) {
    setSelectedPlaylist(pl);
    const res = await fetch("/api/playlists?id=" + pl.id);
    const data = await res.json();
    setPlaylistItems(data.items || []);
  }

  async function deletePlaylist(id) {
    if (!confirm("¿Borrar esta playlist?")) return;
    await fetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlist_id: id }) });
    loadPlaylists();
    if (selectedPlaylist?.id === id) setSelectedPlaylist(null);
  }

  async function removePlaylistItem(itemId) {
    await fetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove-item", item_id: itemId }) });
    if (selectedPlaylist) openPlaylist(selectedPlaylist);
  }

  const SM = { padding: "6px 14px", borderRadius: 6, border: "none", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600 };

  function CoverImg({ url, size = "100%", rounded = 0 }) {
    const w = typeof size === "string" ? size : size + "px";
    if (url) return <img src={url} style={{ width: w, height: w, borderRadius: rounded, objectFit: "cover", display: "block" }} />;
    return (
      <div style={{ width: w, height: w, borderRadius: rounded, background: "linear-gradient(135deg, #1a1a2e, #2a2a3e)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
    );
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  const hasPlayer = playingKey !== null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, paddingBottom: hasPlayer ? 90 : 20 }}>
      {/* Hidden YouTube player container */}
      <div id="yt-player-container" style={{ position: "absolute", top: -9999, left: -9999, width: 1, height: 1, overflow: "hidden" }} />

      {/* Profile header */}
      <div style={{ background: "#1a1a2e", borderRadius: 14, padding: 22, marginBottom: 22, border: "1px solid #2a2a3e", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #7c5cfc, #1ed760)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em", flexShrink: 0 }}>
          {(profile?.display_name || profile?.username || "U")[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <h1 style={{ fontSize: "1.3em", marginBottom: 2 }}>{profile?.display_name || profile?.username || "Usuario"}</h1>
          <p style={{ color: "#888", fontSize: "0.82em" }}>@{profile?.username || "user"}</p>
          <div style={{ display: "flex", gap: 12, color: "#555", fontSize: "0.78em", marginTop: 4 }}>
            <span>{favorites.length} favoritos</span>
            <span>{downloadedMusic.length} descargadas</span>
            <span>{playlists.length} playlists</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setTab("downloads"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "downloads" ? "#22c55e" : "#1a1a2e", color: tab === "downloads" ? "#fff" : "#888", padding: "8px 16px" }}>
          ⬇️ Descargadas ({downloadedMusic.length})
        </button>
        <button onClick={() => { setTab("favorites"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "favorites" ? "#7c5cfc" : "#1a1a2e", color: tab === "favorites" ? "#fff" : "#888", padding: "8px 16px" }}>
          ❤️ Favoritos ({favorites.length})
        </button>
        <button onClick={() => { setTab("playlists"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "playlists" ? "#7c5cfc" : "#1a1a2e", color: tab === "playlists" ? "#fff" : "#888", padding: "8px 16px" }}>
          🎵 Playlists ({playlists.length})
        </button>
      </div>

      {/* ── TAB: Descargadas ── */}
      {tab === "downloads" && (
        <div>
          {downloadedMusic.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
              <div style={{ fontSize: "3em", marginBottom: 12 }}>⬇️</div>
              <p style={{ fontSize: "1.1em", color: "#888", marginBottom: 8 }}>No tenés música descargada</p>
              <p style={{ fontSize: "0.85em" }}>Andá a <a href="/spotify" style={{ color: "#7c5cfc", fontWeight: 600 }}>Música</a> y Dale ❤️ a una canción para descargarla</p>
            </div>
          ) : (
            <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
              {downloadedMusic.map(item => {
                const isCurrentlyPlaying = playingKey === item.key;
                const isDownloading = downloadingItems[item.key];
                return (
                  <div key={item.key} onClick={() => playDownloaded(item)} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 14px",
                    borderBottom: "1px solid #2a2a3e",
                    background: isCurrentlyPlaying ? "rgba(34,197,94,0.08)" : "transparent",
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}>
                    {/* Cover + play overlay */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <CoverImg url={item.cover_url} size={52} rounded={8} />
                      <div style={{
                        position: "absolute", top: "50%", left: "50%",
                        transform: "translate(-50%, -50%)",
                        background: isCurrentlyPlaying && isPlaying ? "rgba(34,197,94,0.9)" : "rgba(0,0,0,0.65)",
                        border: "none", borderRadius: "50%", width: 26, height: 26,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backdropFilter: "blur(4px)",
                      }}>
                        {isCurrentlyPlaying && isPlaying ? (
                          <svg width="8" height="10" viewBox="0 0 8 10" fill="#fff"><rect x="0" y="0" width="2.5" height="10" rx="1"/><rect x="5" y="0" width="2.5" height="10" rx="1"/></svg>
                        ) : (
                          <svg width="8" height="10" viewBox="0 0 8 10" fill="#fff"><polygon points="0,0 8,5 0,10"/></svg>
                        )}
                      </div>
                    </div>

                    {/* Title + Artist + progress */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isCurrentlyPlaying ? "#22c55e" : "#e0e0e0", fontSize: "0.92em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.title}
                      </div>
                      <div style={{ color: "#666", fontSize: "0.78em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.artist}
                      </div>
                      {/* Mini progress bar */}
                      {isCurrentlyPlaying && (
                        <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "#2a2a3e", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 2, background: "#22c55e", width: progress + "%", transition: "width 0.5s linear" }} />
                        </div>
                      )}
                    </div>

                    {/* Time display */}
                    {isCurrentlyPlaying && (
                      <span style={{ color: "#22c55e", fontSize: "0.72em", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    )}

                    {/* YouTube badge */}
                    {item.video_id && (
                      <span style={{
                        padding: "2px 6px", borderRadius: 4, fontSize: "0.6em", fontWeight: 700, flexShrink: 0,
                        background: "rgba(239,68,68,0.15)", color: "#ef4444",
                        border: "1px solid rgba(239,68,68,0.3)",
                      }}>YT</span>
                    )}

                    {/* Apple badge */}
                    {item.apple_url && (
                      <span style={{
                        padding: "2px 6px", borderRadius: 4, fontSize: "0.6em", fontWeight: 700, flexShrink: 0,
                        background: "rgba(124,92,252,0.15)", color: "#7c5cfc",
                        border: "1px solid rgba(124,92,252,0.3)",
                      }}>🍎</span>
                    )}

                    {/* Re-download */}
                    <button
                      onClick={(e) => { e.stopPropagation(); reDownload(item); }}
                      disabled={isDownloading}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.8em", padding: 2, flexShrink: 0 }}
                      title="Buscar de nuevo"
                    >
                      {isDownloading ? "⏳" : "🔄"}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteDownload(item); }}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.8em", padding: 2, flexShrink: 0 }}
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Favoritos ── */}
      {tab === "favorites" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 15 }}>
            {["album", "artist", "track"].map(t => (
              <button key={t} onClick={() => setFavType(t)} style={{ ...SM, background: favType === t ? "#22c55e" : "#1a1a2e", color: favType === t ? "#fff" : "#888" }}>
                {t === "album" ? "Álbumes" : t === "artist" ? "Artistas" : "Canciones"} ({favorites.filter(f => f.item_type === t).length})
              </button>
            ))}
          </div>
          {filteredFavs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "#555" }}>
              <p>No tenés {favType === "album" ? "álbumes" : favType === "artist" ? "artistas" : "canciones"} en favoritos</p>
              <p style={{ fontSize: "0.85em", marginTop: 8 }}><a href="/spotify" style={{ color: "#7c5cfc", fontWeight: 600 }}>Buscar música</a></p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: 10 }}>
              {filteredFavs.map(f => {
                // Check if downloaded (has video_id or audio_url)
                let isDownloaded = false;
                try {
                  const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
                  const keys = [String(f.item_id), (f.artist + " " + f.name).trim(), (f.name + " " + f.artist).trim(), f.name.trim()];
                  for (const k of keys) { if (mp3s[k]?.video_id || mp3s[k]?.audio_url) { isDownloaded = true; break; } }
                } catch {}
                return (
                  <div key={f.id} style={{ background: "#1a1a2e", borderRadius: 10, overflow: "hidden", border: "1px solid #2a2a3e", position: "relative" }}>
                    <a href={`/spotify?album=${f.extra_data?.album_id || f.item_id}&source=${f.source}`} style={{ textDecoration: "none", display: "block" }}>
                      <CoverImg url={f.cover_url} />
                    </a>
                    {isDownloaded && (
                      <span style={{ position: "absolute", bottom: 28, left: 4, background: "rgba(34,197,94,0.9)", color: "#fff", padding: "1px 5px", borderRadius: 4, fontSize: "0.6em", fontWeight: 700 }}>⬇️</span>
                    )}
                    <button onClick={() => toggleFavorite(f.item_type, f.item_id)} style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div style={{ padding: "7px 9px" }}>
                      <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      <div style={{ color: "#666", fontSize: "0.68em" }}>{f.artist}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Playlists ── */}
      {tab === "playlists" && !selectedPlaylist && (
        <div>
          {playlists.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "#555" }}>
              <p>No tenés playlists</p>
              <p style={{ fontSize: "0.85em", marginTop: 8 }}><a href="/spotify" style={{ color: "#7c5cfc", fontWeight: 600 }}>Buscar música para agregar</a></p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {playlists.map(pl => (
                <div key={pl.id} onClick={() => openPlaylist(pl)} style={{ background: "#1a1a2e", borderRadius: 10, padding: 14, cursor: "pointer", border: "1px solid #2a2a3e", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <CoverImg url={pl.cover_url} size={44} rounded={6} />
                    <div>
                      <div style={{ color: "#ccc", fontWeight: 600, fontSize: "0.9em" }}>{pl.name}</div>
                      {pl.description && <div style={{ color: "#555", fontSize: "0.72em" }}>{pl.description}</div>}
                    </div>
                  </div>
                  <div style={{ color: "#444", fontSize: "0.7em" }}>{pl.is_public ? "Pública" : "Privada"} · {new Date(pl.created_at).toLocaleDateString("es")}</div>
                  <button onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }} style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.85em" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlist detail */}
      {tab === "playlists" && selectedPlaylist && (
        <div>
          <button onClick={() => setSelectedPlaylist(null)} style={{ ...SM, background: "#333", marginBottom: 15, color: "#7c5cfc" }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 10, padding: 16, marginBottom: 15, border: "1px solid #2a2a3e", display: "flex", gap: 12, alignItems: "center" }}>
            <CoverImg url={selectedPlaylist.cover_url} size={56} rounded={8} />
            <div>
              <h2 style={{ fontSize: "1.2em", marginBottom: 2 }}>{selectedPlaylist.name}</h2>
              <p style={{ color: "#888", fontSize: "0.8em" }}>{selectedPlaylist.description || "Sin descripción"} · {playlistItems.length} items</p>
            </div>
          </div>
          {playlistItems.length === 0 ? (
            <p style={{ textAlign: "center", color: "#555", padding: 20 }}>Playlist vacía</p>
          ) : (
            <div style={{ background: "#1a1a2e", borderRadius: 10, border: "1px solid #2a2a3e", overflow: "hidden" }}>
              {playlistItems.map(item => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid #2a2a3e" }}>
                  <CoverImg url={item.cover_url} size={40} rounded={6} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#e0e0e0", fontSize: "0.88em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    <div style={{ color: "#666", fontSize: "0.75em" }}>{item.artist}</div>
                  </div>
                  <button onClick={() => removePlaylistItem(item.id)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.9em" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Now Playing Bar (bottom) ── */}
      {hasPlayer && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "rgba(10,10,20,0.97)",
          borderTop: "1px solid #2a2a3e",
          padding: "0",
          zIndex: 9999,
          backdropFilter: "blur(16px)",
        }}>
          {/* Progress bar on top of the bar */}
          <div style={{ height: 3, background: "#1a1a2e", cursor: "pointer" }}
            onClick={(e) => {
              if (!playerRef.current || !duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              playerRef.current.seekTo(pct * duration, true);
              setProgress(pct * 100);
            }}
          >
            <div style={{ height: "100%", background: "#22c55e", width: progress + "%", transition: "width 0.3s linear" }} />
          </div>
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            {playingCover && <img src={playingCover} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0, boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#22c55e", fontSize: "0.88em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                🎵 {playingTitle}
              </div>
              <div style={{ color: "#888", fontSize: "0.75em" }}>{playingArtist} · {formatTime(currentTime)} / {formatTime(duration)}</div>
            </div>
            {/* Play/Pause */}
            <button
              onClick={() => {
                if (!playerRef.current) return;
                if (isPlaying) { playerRef.current.pauseVideo(); setIsPlaying(false); }
                else { playerRef.current.playVideo(); setIsPlaying(true); }
              }}
              style={{ background: isPlaying ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.9)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 10 10" fill="#22c55e"><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></svg>
              ) : (
                <svg width="12" height="14" viewBox="0 0 10 12" fill="#fff"><polygon points="0,0 10,6 0,12"/></svg>
              )}
            </button>
            {/* Stop */}
            <button
              onClick={stopPlayback}
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="#ef4444"><rect x="0" y="0" width="10" height="10" rx="2"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
