"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";

export default function ProfilePage() {
  const { user, profile, favorites, playlists, loading, isFavorite, toggleFavorite, loadFavorites, loadPlaylists, checkSession } = useUser();
  const [tab, setTab] = useState("downloads");
  const [favType, setFavType] = useState("album");
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [downloadingItems, setDownloadingItems] = useState({});
  const audioRef = useRef(null);
  const toast = useToast();

  // Load downloaded music from localStorage
  const [downloadedMusic, setDownloadedMusic] = useState([]);

  function refreshDownloads() {
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const offline = JSON.parse(localStorage.getItem("ml_offline") || "{}");
      const items = [];
      for (const [key, entry] of Object.entries(mp3s)) {
        if (!entry.audio_url && !entry.apple_url) continue;
        // Try to find matching offline entry for cover art
        let coverUrl = "";
        let artistName = "";
        let trackName = entry.title || key;
        // Parse key: "Artist SongName" format
        const offlineEntry = offline[key];
        if (offlineEntry) {
          coverUrl = offlineEntry.cover_url || "";
          artistName = offlineEntry.artist || "";
          trackName = offlineEntry.name || trackName;
        }
        // Also try to find cover from favorites
        if (!coverUrl) {
          const favMatch = favorites.find(f => {
            const keys = [
              String(f.item_id),
              (f.artist + " " + f.name).trim(),
              (f.name + " " + f.artist).trim(),
              f.name.trim(),
            ];
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
          audio_url: entry.audio_url || "",
          apple_url: entry.apple_url || "",
          method: entry.method || (entry.audio_url ? "youtube" : "aaplmusicdownloader"),
          saved_at: entry.saved_at || 0,
        });
      }
      // Sort by most recent
      items.sort((a, b) => b.saved_at - a.saved_at);
      setDownloadedMusic(items);
    } catch {
      setDownloadedMusic([]);
    }
  }

  useEffect(() => {
    refreshDownloads();
  }, [favorites]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => {
        setPlayingId(null);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
          navigator.mediaSession.metadata = null;
        }
      });
    }
  }, []);

  async function playDownloaded(item) {
    const audio = audioRef.current;
    if (!audio) return;

    // If same track, pause
    if (playingId === item.key) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingId(null);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      return;
    }

    audio.pause();
    audio.currentTime = 0;

    let playUrl = item.audio_url;
    if (!playUrl) {
      toast.warning("⚠️ No hay audio reproducible. Usá Apple Music para descargar.", 4000);
      if (item.apple_url) {
        window.open("https://aaplmusicdownloader.com/", "_blank");
      }
      return;
    }

    // Try to serve from Service Worker cache first
    let fromCache = false;
    if ("caches" in window) {
      try {
        const cache = await caches.open("ml-saved-v1");
        const cached = await cache.match(playUrl);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          if (blob.size > 1000) {
            playUrl = URL.createObjectURL(blob);
            fromCache = true;
          }
        }
      } catch {}
    }

    // If not in cache, try fetching directly
    if (!fromCache && playUrl.startsWith("http")) {
      try {
        const res = await fetch(playUrl);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 1000) {
            playUrl = URL.createObjectURL(blob);
            // Re-cache it
            try {
              const cache = await caches.open("ml-saved-v1");
              await cache.put(item.audio_url, new Response(blob));
            } catch {}
          }
        }
      } catch {
        toast.error("❌ El audio expiró. Buscando de nuevo...", 3000);
        // Try to re-download
        reDownload(item);
        return;
      }
    }

    audio.src = playUrl;
    setPlayingId(item.key);

    // Media Session
    if ("mediaSession" in navigator) {
      const coverUrl = item.cover_url || "";
      const artworkSrc = coverUrl ? "/api/proxy?url=" + encodeURIComponent(coverUrl) : "";
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
        audio.play().catch(() => {});
        navigator.mediaSession.playbackState = "playing";
        setPlayingId(item.key);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audio.pause();
        navigator.mediaSession.playbackState = "paused";
      });
      try { navigator.mediaSession.setActionHandler("stop", () => { audio.pause(); audio.currentTime = 0; setPlayingId(null); navigator.mediaSession.playbackState = "none"; }); } catch {}
      try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
      try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
    }

    audio.play().then(() => {
      toast.success("🎵 Reproduciendo: " + item.title, 3000);
    }).catch(() => {
      toast.error("❌ No se pudo reproducir", 3000);
      setPlayingId(null);
    });
  }

  async function playFavorite(fav) {
    const audio = audioRef.current;
    if (!audio) return;

    if (playingId === fav.id) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingId(null);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
      return;
    }

    audio.pause();
    audio.currentTime = 0;

    // Check if we have a full MP3 cached
    let playUrl = "";
    let isFullMp3 = false;
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const keys = [
        String(fav.item_id),
        (fav.artist + " " + fav.name).trim(),
        (fav.name + " " + fav.artist).trim(),
        fav.name.trim(),
      ];
      for (const k of keys) {
        if (mp3s[k]?.audio_url) {
          playUrl = mp3s[k].audio_url;
          isFullMp3 = true;
          break;
        }
      }
    } catch {}

    // Try Service Worker cache
    if (isFullMp3 && playUrl && "caches" in window) {
      try {
        const cache = await caches.open("ml-saved-v1");
        const cached = await cache.match(playUrl);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          if (blob.size > 1000) {
            playUrl = URL.createObjectURL(blob);
          } else {
            playUrl = "";
            isFullMp3 = false;
          }
        } else {
          playUrl = "";
          isFullMp3 = false;
        }
      } catch {}
    }

    // Fall back to preview
    if (!isFullMp3) {
      playUrl = fav.extra_data?.preview_url || "";
    }

    if (!playUrl) {
      toast.info("💡 Descargá la canción primero con el ❤️ para escucharla completa", 4000);
      return;
    }

    audio.src = playUrl;
    setPlayingId(fav.id);

    // Media Session
    if ("mediaSession" in navigator) {
      const coverUrl = fav.cover_url || "";
      const artworkSrc = coverUrl ? "/api/proxy?url=" + encodeURIComponent(coverUrl) : "";
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: fav.name || "Cancion",
          artist: fav.artist || "",
          album: "",
          artwork: artworkSrc ? [
            { src: artworkSrc, sizes: "96x96", type: "image/jpeg" },
            { src: artworkSrc, sizes: "256x256", type: "image/jpeg" },
            { src: artworkSrc, sizes: "512x512", type: "image/jpeg" },
          ] : [],
        });
      } catch {}
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => { audio.play().catch(() => {}); navigator.mediaSession.playbackState = "playing"; setPlayingId(fav.id); });
      navigator.mediaSession.setActionHandler("pause", () => { audio.pause(); navigator.mediaSession.playbackState = "paused"; });
      try { navigator.mediaSession.setActionHandler("stop", () => { audio.pause(); audio.currentTime = 0; setPlayingId(null); navigator.mediaSession.playbackState = "none"; }); } catch {}
      try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
      try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
    }

    audio.play().then(() => {
      if (isFullMp3) toast.success("🎵 MP3 completo: " + fav.name, 3000);
    }).catch(() => {});
  }

  async function reDownload(item) {
    setDownloadingItems(prev => ({ ...prev, [item.key]: true }));
    toast.download("⬇️ Buscando de nuevo: " + item.title, 3000);
    try {
      const searchQuery = (item.artist + " " + item.title).trim() || item.key;
      const params = new URLSearchParams();
      params.set("q", searchQuery);
      if (item.apple_url) params.set("itunes_url", item.apple_url);
      const res = await fetch("/api/download-mp3?" + params.toString());
      const data = await res.json();
      if (data.audio_url) {
        if ("caches" in window) {
          const cache = await caches.open("ml-saved-v1");
          await cache.add(data.audio_url);
        }
        try {
          const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
          saved[item.key] = { ...saved[item.key], audio_url: data.audio_url, saved_at: Date.now() };
          localStorage.setItem("ml_mp3", JSON.stringify(saved));
        } catch {}
        toast.success("✅ Audio actualizado: " + item.title, 4000);
        refreshDownloads();
      } else {
        toast.warning("⚠️ No se encontró audio para re-descargar", 4000);
      }
    } catch {
      toast.error("❌ Error al re-descargar", 3000);
    }
    setDownloadingItems(prev => ({ ...prev, [item.key]: false }));
  }

  async function deleteDownload(item) {
    try {
      const saved = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      delete saved[item.key];
      localStorage.setItem("ml_mp3", JSON.stringify(saved));
      // Also try to remove from cache
      if (item.audio_url && "caches" in window) {
        try {
          const cache = await caches.open("ml-saved-v1");
          await cache.delete(item.audio_url);
        } catch {}
      }
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

  // Now playing bar at bottom
  const nowPlaying = downloadedMusic.find(d => d.key === playingId) || favorites.find(f => f.id === playingId);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, paddingBottom: nowPlaying ? 80 : 20 }}>
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
                const isPlaying = playingId === item.key;
                const isDownloading = downloadingItems[item.key];
                return (
                  <div key={item.key} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 14px",
                    borderBottom: "1px solid #2a2a3e",
                    background: isPlaying ? "rgba(124,92,252,0.08)" : "transparent",
                    transition: "background 0.2s",
                  }}>
                    {/* Cover */}
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <CoverImg url={item.cover_url} size={52} rounded={8} />
                      {/* Play overlay on cover */}
                      <button
                        onClick={() => playDownloaded(item)}
                        style={{
                          position: "absolute", top: "50%", left: "50%",
                          transform: "translate(-50%, -50%)",
                          background: isPlaying ? "rgba(124,92,252,0.9)" : "rgba(0,0,0,0.7)",
                          border: "none", borderRadius: "50%", width: 28, height: 28,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          backdropFilter: "blur(4px)",
                        }}
                      >
                        {isPlaying ? (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="#fff"><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></svg>
                        ) : (
                          <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff"><polygon points="0,0 10,6 0,12"/></svg>
                        )}
                      </button>
                    </div>

                    {/* Title + Artist */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isPlaying ? "#7c5cfc" : "#e0e0e0", fontSize: "0.92em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.title}
                      </div>
                      <div style={{ color: "#666", fontSize: "0.78em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.artist}
                      </div>
                    </div>

                    {/* Method badge */}
                    <span style={{
                      padding: "2px 7px", borderRadius: 5, fontSize: "0.65em", fontWeight: 700, flexShrink: 0,
                      background: item.method === "aaplmusicdownloader" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
                      color: item.method === "aaplmusicdownloader" ? "#ef4444" : "#22c55e",
                      border: `1px solid ${item.method === "aaplmusicdownloader" ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                    }}>
                      {item.method === "aaplmusicdownloader" ? "🍎 Apple" : "▶️ YT"}
                    </span>

                    {/* Re-download button */}
                    <button
                      onClick={() => reDownload(item)}
                      disabled={isDownloading}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.85em", padding: 4, flexShrink: 0 }}
                      title="Re-descargar audio"
                    >
                      {isDownloading ? "⏳" : "🔄"}
                    </button>

                    {/* Apple Music link */}
                    {item.apple_url && (
                      <a
                        href={"https://aaplmusicdownloader.com/"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); toast.info("🍎 Pegá este link en aaplmusicdownloader.com — copialo del botón de abajo", 5000); }}
                        style={{ color: "#555", fontSize: "0.85em", textDecoration: "none", flexShrink: 0 }}
                        title="Descargar de Apple Music"
                      >
                        🍎
                      </a>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => deleteDownload(item)}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.85em", padding: 4, flexShrink: 0 }}
                      title="Eliminar descarga"
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
                const isPlaying = playingId === f.id;
                // Check if full MP3 is available
                let hasMp3 = false;
                try {
                  const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
                  const keys = [
                    String(f.item_id),
                    (f.artist + " " + f.name).trim(),
                    (f.name + " " + f.artist).trim(),
                    f.name.trim(),
                  ];
                  for (const k of keys) {
                    if (mp3s[k]?.audio_url) { hasMp3 = true; break; }
                  }
                } catch {}
                const showPlay = f.item_type === "track" && (f.extra_data?.preview_url || hasMp3);
                return (
                  <div key={f.id} style={{ background: "#1a1a2e", borderRadius: 10, overflow: "hidden", border: "1px solid #2a2a3e", position: "relative" }}>
                    <div style={{ position: "relative", cursor: showPlay ? "pointer" : "default" }} onClick={() => { if (showPlay) playFavorite(f); }}>
                      <CoverImg url={f.cover_url} />
                      {/* Play overlay */}
                      {showPlay && (
                        <button
                          onClick={(e) => { e.stopPropagation(); playFavorite(f); }}
                          style={{
                            position: "absolute", top: "50%", left: "50%",
                            transform: "translate(-50%, -50%)",
                            background: isPlaying ? "rgba(124,92,252,0.9)" : hasMp3 ? "rgba(34,197,94,0.85)" : "rgba(0,0,0,0.6)",
                            border: "none", borderRadius: "50%", width: 36, height: 36,
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            backdropFilter: "blur(4px)",
                          }}
                        >
                          {isPlaying ? (
                            <svg width="12" height="12" viewBox="0 0 10 10" fill="#fff"><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></svg>
                          ) : (
                            <svg width="12" height="14" viewBox="0 0 10 12" fill="#fff"><polygon points="0,0 10,6 0,12"/></svg>
                          )}
                        </button>
                      )}
                      {/* MP3 badge */}
                      {hasMp3 && (
                        <span style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(34,197,94,0.9)", color: "#fff", padding: "1px 5px", borderRadius: 4, fontSize: "0.6em", fontWeight: 700 }}>MP3</span>
                      )}
                    </div>
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
      {nowPlaying && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "rgba(15,15,26,0.97)",
          borderTop: "1px solid #2a2a3e",
          padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 12,
          zIndex: 9999,
          backdropFilter: "blur(12px)",
        }}>
          {nowPlaying.cover_url && <img src={nowPlaying.cover_url} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#7c5cfc", fontSize: "0.88em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              🎵 {nowPlaying.title || nowPlaying.name}
            </div>
            <div style={{ color: "#666", fontSize: "0.75em" }}>{nowPlaying.artist}</div>
          </div>
          <button
            onClick={() => {
              if (playingId && audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                setPlayingId(null);
                if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
              }
            }}
            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
