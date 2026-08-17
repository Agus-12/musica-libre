"use client";
import { useState, useEffect } from "react";
import { useUser } from "../components/UserContext";
import AuthModal from "../components/AuthModal";

export default function ProfilePage() {
  const { user, profile, favorites, playlists, loading, isFavorite, toggleFavorite, loadFavorites, loadPlaylists, checkSession } = useUser();
  const [showAuth, setShowAuth] = useState(false);
  const [tab, setTab] = useState("favorites"); // favorites, playlists
  const [favType, setFavType] = useState("album"); // album, artist, track
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setBio(profile.bio || "");
    }
  }, [profile]);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#7c5cfc", fontSize: "1.2em" }}>⏳ Cargando...</div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 500, margin: "0 auto", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: "4em", marginBottom: 15 }}>🔒</div>
        <h1 style={{ fontSize: "1.5em", marginBottom: 10 }}>Iniciá sesión</h1>
        <p style={{ color: "#888", marginBottom: 25 }}>Para ver tu perfil, favoritos y playlists</p>
        <button onClick={() => setShowAuth(true)} style={{ padding: "14px 28px", borderRadius: 12, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 700 }}>
          Iniciar sesión
        </button>
        {showAuth && <AuthModal onClose={() => { setShowAuth(false); checkSession(); }} />}
      </div>
    );
  }

  const filteredFavs = favorites.filter(f => f.item_type === favType);

  async function openPlaylist(pl) {
    setSelectedPlaylist(pl);
    const res = await fetch("/api/playlists?id=" + pl.id);
    const data = await res.json();
    setPlaylistItems(data.items || []);
  }

  async function updateProfile() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // We'll use the API
    setEditingProfile(false);
    // For simplicity, we update via a direct fetch
  }

  async function logout() {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    checkSession();
  }

  async function deletePlaylist(id) {
    if (!confirm("¿Borrar esta playlist?")) return;
    await fetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlist_id: id }) });
    loadPlaylists();
    if (selectedPlaylist?.id === id) setSelectedPlaylist(null);
  }

  async function removeFavorite(itemType, itemId) {
    await toggleFavorite(itemType, itemId);
  }

  async function removePlaylistItem(itemId) {
    await fetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove-item", item_id: itemId }) });
    if (selectedPlaylist) openPlaylist(selectedPlaylist);
  }

  const SM = { padding: "6px 14px", borderRadius: 6, border: "none", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600 };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      {/* Profile header */}
      <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 25, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #7c5cfc, #1ed760)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5em", flexShrink: 0 }}>
          {(profile?.display_name || profile?.username || "U")[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <h1 style={{ fontSize: "1.4em", marginBottom: 3 }}>{profile?.display_name || profile?.username || "Usuario"}</h1>
          <p style={{ color: "#888", fontSize: "0.85em", marginBottom: 3 }}>@{profile?.username || "user"}</p>
          {profile?.bio && <p style={{ color: "#aaa", fontSize: "0.85em", marginBottom: 5 }}>{profile.bio}</p>}
          <div style={{ display: "flex", gap: 15, color: "#555", fontSize: "0.8em" }}>
            <span>❤️ {favorites.length} favoritos</span>
            <span>🎵 {playlists.length} playlists</span>
          </div>
        </div>
        <button onClick={logout} style={{ ...SM, background: "#555" }}>Salir</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        <button onClick={() => { setTab("favorites"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "favorites" ? "#7c5cfc" : "#1a1a2e", color: tab === "favorites" ? "#fff" : "#888", padding: "8px 16px" }}>
          ❤️ Favoritos ({favorites.length})
        </button>
        <button onClick={() => { setTab("playlists"); setSelectedPlaylist(null); }} style={{ ...SM, background: tab === "playlists" ? "#7c5cfc" : "#1a1a2e", color: tab === "playlists" ? "#fff" : "#888", padding: "8px 16px" }}>
          🎵 Playlists ({playlists.length})
        </button>
      </div>

      {/* Favorites tab */}
      {tab === "favorites" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 15 }}>
            {["album", "artist", "track"].map(t => (
              <button key={t} onClick={() => setFavType(t)} style={{ ...SM, background: favType === t ? "#22c55e" : "#1a1a2e", color: favType === t ? "#fff" : "#888" }}>
                {t === "album" ? "💿" : t === "artist" ? "🎤" : "🎶"} {t === "album" ? "Álbumes" : t === "artist" ? "Artistas" : "Canciones"} ({favorites.filter(f => f.item_type === t).length})
              </button>
            ))}
          </div>

          {filteredFavs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
              <div style={{ fontSize: "2em", marginBottom: 10 }}>{favType === "album" ? "💿" : favType === "artist" ? "🎤" : "🎶"}</div>
              <p>No tenés {favType === "album" ? "álbumes" : favType === "artist" ? "artistas" : "canciones"} en favoritos</p>
              <p style={{ fontSize: "0.85em" }}>Buscá en <a href="/spotify" style={{ color: "#7c5cfc" }}>Música Libre</a> y tocá el ❤️</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10 }}>
              {filteredFavs.map(f => (
                <div key={f.id} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", border: "1px solid #2a2a3e", position: "relative" }}>
                  <a href={f.item_type === "album" ? `/spotify?album=${f.item_id}&source=${f.source}` : `/spotify?artist=${f.item_id}`} style={{ textDecoration: "none" }}>
                    <img src={f.cover_url || ""} style={{ width: "100%", aspectRatio: f.item_type === "artist" ? "1/1" : "1/1", objectFit: "cover", display: "block", borderRadius: f.item_type === "artist" ? "50%" : 0, margin: f.item_type === "artist" ? "10px auto" : 0, width: f.item_type === "artist" ? "80%" : "100%" }} />
                  </a>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ color: "#666", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.artist}</div>
                  </div>
                  <button onClick={() => removeFavorite(f.item_type, f.item_id)} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 28, height: 28, color: "#ef4444", cursor: "pointer", fontSize: "0.9em", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlists tab */}
      {tab === "playlists" && !selectedPlaylist && (
        <div>
          {playlists.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
              <div style={{ fontSize: "2em", marginBottom: 10 }}>🎵</div>
              <p>No tenés playlists</p>
              <p style={{ fontSize: "0.85em" }}>Agregá álbumes o canciones desde <a href="/spotify" style={{ color: "#7c5cfc" }}>Música Libre</a></p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {playlists.map(pl => (
                <div key={pl.id} onClick={() => openPlaylist(pl)} style={{ background: "#1a1a2e", borderRadius: 12, padding: 15, cursor: "pointer", border: "1px solid #2a2a3e", position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    {pl.cover_url ? (
                      <img src={pl.cover_url} style={{ width: 50, height: 50, borderRadius: 8, objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: 50, height: 50, borderRadius: 8, background: "linear-gradient(135deg,#7c5cfc,#1ed760)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5em" }}>🎵</div>
                    )}
                    <div>
                      <div style={{ color: "#ccc", fontWeight: 600, fontSize: "0.95em" }}>{pl.name}</div>
                      <div style={{ color: "#555", fontSize: "0.75em" }}>{pl.description || ""}</div>
                    </div>
                  </div>
                  <div style={{ color: "#555", fontSize: "0.75em" }}>
                    {pl.is_public ? "🌍 Pública" : "🔒 Privada"} • Creada {new Date(pl.created_at).toLocaleDateString("es")}
                  </div>
                  <button onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }} style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "1em" }}>🗑️</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Playlist detail */}
      {tab === "playlists" && selectedPlaylist && (
        <div>
          <button onClick={() => setSelectedPlaylist(null)} style={{ ...SM, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 15, alignItems: "center" }}>
            {selectedPlaylist.cover_url ? (
              <img src={selectedPlaylist.cover_url} style={{ width: 70, height: 70, borderRadius: 10, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 70, height: 70, borderRadius: 10, background: "linear-gradient(135deg,#7c5cfc,#1ed760)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>🎵</div>
            )}
            <div>
              <h2 style={{ fontSize: "1.3em", marginBottom: 3 }}>{selectedPlaylist.name}</h2>
              <p style={{ color: "#888", fontSize: "0.85em" }}>{selectedPlaylist.description || "Sin descripción"}</p>
              <p style={{ color: "#555", fontSize: "0.8em" }}>{playlistItems.length} items</p>
            </div>
          </div>

          {playlistItems.length === 0 ? (
            <p style={{ textAlign: "center", color: "#555", padding: 30 }}>Playlist vacía. Agregá álbumes o canciones desde Música Libre.</p>
          ) : (
            <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
              {playlistItems.map((item, i) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 15px", borderBottom: "1px solid #2a2a3e" }}>
                  <img src={item.cover_url || ""} style={{ width: 45, height: 45, borderRadius: 6, objectFit: "cover" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#e0e0e0", fontSize: "0.9em" }}>{item.name}</div>
                    <div style={{ color: "#666", fontSize: "0.8em" }}>{item.artist} • {item.item_type === "album" ? "💿 Álbum" : "🎶 Canción"}</div>
                  </div>
                  <button onClick={() => removePlaylistItem(item.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.85em" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
