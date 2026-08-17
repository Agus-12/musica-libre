"use client";
import { useState, useEffect, createContext, useContext, useCallback } from "react";

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        setProfile(data.profile);
        loadFavorites();
        loadPlaylists();
      }
    } catch {}
    setLoading(false);
  }

  async function loadFavorites() {
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json();
      if (data.favorites) setFavorites(data.favorites);
    } catch {}
  }

  async function loadPlaylists() {
    try {
      const res = await fetch("/api/playlists");
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists);
    } catch {}
  }

  const isFavorite = useCallback((itemType, itemId) => {
    return favorites.some(f => f.item_type === itemType && f.item_id === String(itemId));
  }, [favorites]);

  async function toggleFavorite(itemType, itemId, name, artist, coverUrl, source) {
    if (!user) return false;
    const isFav = isFavorite(itemType, itemId);
    try {
      if (isFav) {
        const res = await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_type: itemType, item_id: String(itemId) }),
        });
        if (res.ok) {
          setFavorites(prev => prev.filter(f => !(f.item_type === itemType && f.item_id === String(itemId))));
          return false;
        }
      } else {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_type: itemType,
            item_id: String(itemId),
            name,
            artist,
            cover_url: coverUrl,
            source: source || "deezer",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.favorite) setFavorites(prev => [data.favorite, ...prev]);
          return true;
        }
      }
    } catch {}
    return isFav;
  }

  async function createPlaylist(name, description) {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    if (data.playlist) {
      setPlaylists(prev => [data.playlist, ...prev]);
      return data.playlist;
    }
    return null;
  }

  async function addToPlaylist(playlistId, itemType, itemId, name, artist, coverUrl, source) {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add-item",
        playlist_id: playlistId,
        item_type: itemType,
        item_id: String(itemId),
        name,
        artist,
        cover_url: coverUrl,
        source: source || "deezer",
      }),
    });
    return res.ok;
  }

  return (
    <UserContext.Provider value={{
      user, profile, favorites, playlists, loading,
      isFavorite, toggleFavorite,
      createPlaylist, addToPlaylist,
      loadFavorites, loadPlaylists,
      setUser, setProfile,
      checkSession,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
