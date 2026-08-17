"use client";
import { useState, useEffect, useRef } from "react";
import { useUser } from "../components/UserContext";
import { useToast } from "../components/ToastContext";

export default function ProfilePage() {
  const { user, profile, favorites, playlists, loading, isFavorite, toggleFavorite, loadFavorites, loadPlaylists, checkSession } = useUser();
  const [tab, setTab] = useState("favorites");
  const [favType, setFavType] = useState("album");
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(null);
  const audioRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => {
        setPlayingId(null);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
      });
    }
  }, []);

  async function playFavorite(fav) {
    const audio = audioRef.current;
    if (!audio) return;

    // If same track, pause
    if (playingId === fav.id) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingId(null);
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
      return;
    }

    // Get preview URL from extra_data, or try loading the album
    let previewUrl = fav.extra_data?.preview_url || "";

    // Check if we have a full MP3 cached first
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
          previewUrl = mp3s[k].audio_url;
          isFullMp3 = true;
          break;
        }
      }
    } catch {}

    // Try to serve from Service Worker cache (YouTube URLs expire)
    if (isFullMp3 && "caches" in window) {
      try {
        const cache = await caches.open("ml-saved-v1");
        const cached = await cache.match(previewUrl);
        if (cached && cached.ok) {
          const blob = await cached.blob();
          if (blob.size > 1000) {
            previewUrl = URL.createObjectURL(blob);
          }
        }
      } catch {}
    }

    // If no MP3 cached, try to load preview from album API
    if (!isFullMp3 && !previewUrl && fav.extra_data?.album_id) {
      setLoadingPreview(fav.id);
      try {
        const source = fav.source || "itunes";
        const endpoint = source === "itunes"
          ? "/api/music?action=lookup&id=" + fav.extra_data.album_id + "&source=itunes"
          : "/api/music?action=album&id=" + fav.extra_data.album_id + "&source=deezer";
        const res = await fetch(endpoint);
        const data = await res.json();
        // Find the track in the album
        const track = data.tracks?.find(t => t.name === fav.name);
        if (track?.preview_url) previewUrl = track.preview_url;
      } catch {}
      setLoadingPreview(null);
    }

    // Show notification if playing full MP3
    if (isFullMp3) {
      toast.success("🎵 Reproduciendo MP3 completo: " + fav.name, 3000);
    }

    if (!previewUrl) {
      // No preview available, just go to the album page
      window.location.href = "/spotify?album=" + (fav.item_id || fav.extra_data?.album_id) + "&source=" + (fav.source || "deezer");
      return;
    }

    // Play with Media Session
    audio.pause();
    audio.currentTime = 0;
    audio.src = previewUrl;
    setPlayingId(fav.id);

    if ("mediaSession" in navigator) {
      const coverUrl = fav.cover_url || "";
      // Proxy artwork to avoid CORS issues with Media Session
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
      navigator.mediaSession.setActionHandler("play", () => {
        audio.play().catch(() => {});
        navigator.mediaSession.playbackState = "playing";
        setPlayingId(fav.id);
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audio.pause();
        navigator.mediaSession.playbackState = "paused";
      });
      try { navigator.mediaSession.setActionHandler("stop", () => { audio.pause(); audio.currentTime = 0; setPlayingId(null); navigator.mediaSession.playbackState = "none"; }); } catch {}
      try { navigator.mediaSession.setActionHandler("nexttrack", null); } catch {}
      try { navigator.mediaSession.setActionHandler("previoustrack", null); } catch {}
    }

    audio.play().catch(() => {});
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

  function PlayBtn({ fav }) {
    const isPlaying = playingId === fav.id;
    const isLoading = loadingPreview === fav.id;
    // Check if full MP3 is available
    let hasMp3 = false;
    try {
      const mp3s = JSON.parse(localStorage.getItem("ml_mp3") || "{}");
      const keys = [
        String(fav.item_id),
        (fav.artist + " " + fav.name).trim(),
        (fav.name + " " + fav.artist).trim(),
        fav.name.trim(),
      ];
      for (const k of keys) {
        if (mp3s[k]?.audio_url) { hasMp3 = true; break; }
      }
    } catch {}
    // Only show for tracks that might have a preview
    if (fav.item_type !== "track") return null;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); playFavorite(fav); }}
        style={{
          position: "absolute", top: 5, left: 5,
          background: isPlaying ? "rgba(124,92,252,0.9)" : hasMp3 ? "rgba(34,197,94,0.8)" : "rgba(0,0,0,0.6)",
          border: "none", borderRadius: "50%", width: 28, height: 28,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {isLoading ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        ) : isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="#fff"><rect x="0" y="0" width="3" height="10" rx="1"/><rect x="6" y="0" width="3" height="10" rx="1"/></svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="#fff"><polygon points="0,0 10,6 0,12"/></svg>
        )}
      </button>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
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
            <span>{playlists.length} playlists</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        <button onClick={() => { setTab("favorites"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "favorites" ? "#7c5cfc" : "#1a1a2e", color: tab === "favorites" ? "#fff" : "#888", padding: "8px 16px" }}>
          Favoritos ({favorites.length})
        </button>
        <button onClick={() => { setTab("playlists"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "playlists" ? "#7c5cfc" : "#1a1a2e", color: tab === "playlists" ? "#fff" : "#888", padding: "8px 16px" }}>
          Playlists ({playlists.length})
        </button>
      </div>

      {/* Favorites */}
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
              {filteredFavs.map(f => (
                <div key={f.id} style={{ background: "#1a1a2e", borderRadius: 10, overflow: "hidden", border: "1px solid #2a2a3e", position: "relative" }}>
                  <a href={`/spotify?album=${f.extra_data?.album_id || f.item_id}&source=${f.source}`} style={{ textDecoration: "none", display: "block" }}>
                    <CoverImg url={f.cover_url} />
                  </a>
                  <PlayBtn fav={f} />
                  <button onClick={() => toggleFavorite(f.item_type, f.item_id)} style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                  <div style={{ padding: "7px 9px" }}>
                    <div style={{ color: "#ccc", fontSize: "0.78em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ color: "#666", fontSize: "0.68em" }}>{f.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlists */}
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
    </div>
  );
}
