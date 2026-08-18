"use client";
import { useState, useEffect, createContext, useContext, useCallback } from "react";

const UserContext = createContext(null);

// Offline cache helpers
function saveOffline(key, data) {
  try { localStorage.setItem("ml_offline_" + key, JSON.stringify(data)); } catch {}
}
function loadOffline(key) {
  try { return JSON.parse(localStorage.getItem("ml_offline_" + key)); } catch { return null; }
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [favorites, setFavorites] = useState(loadOffline("favorites") || []);
  const [playlists, setPlaylists] = useState(loadOffline("playlists") || []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* ARRANQUE INSTANTÁNEO: si hay sesión guardada, la usamos YA y la
       verificación con el servidor corre por detrás. Antes, cada
       apertura mostraba "Cargando..." 1-3 segundos esperando a Supabase
       aunque el usuario llevara semanas logueado. */
    const cachedUser = loadOffline("user");
    if (cachedUser) {
      setUser(cachedUser);
      setProfile(loadOffline("profile"));
      setLoading(false);
    }
    /* FAILSAFE: la pantalla "Cargando..." JAMÁS puede quedarse pegada.
       Si en 6 s la sesión no respondió (red lenta, LTE moribundo), la
       app entra igual con lo que haya guardado. */
    const tope = setTimeout(() => setLoading(false), 6000);
    checkSession().finally(() => clearTimeout(tope));
  }, []);

  // Keep offline cache in sync
  useEffect(() => { saveOffline("favorites", favorites); }, [favorites]);
  useEffect(() => { saveOffline("playlists", playlists); }, [playlists]);

  async function checkSession() {
    /* Modo sin datos activo: ni intentamos tocar la red */
    try {
      if (localStorage.getItem("aura_sin_datos") === "1") {
        const cachedUser = loadOffline("user");
        if (cachedUser) { setUser(cachedUser); setProfile(loadOffline("profile")); }
        setLoading(false);
        return;
      }
    } catch {}
    try {
      const res = await fetch("/api/auth", { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        setProfile(data.profile);
        // Save for offline
        saveOffline("user", data.user);
        saveOffline("profile", data.profile);
        /* Ajustes sincronizados con la cuenta: si el perfil trae tema/
           color/fuente, se aplican en este dispositivo también. */
        try {
          const aj = data.profile?.ajustes;
          if (aj && typeof aj === "object") {
            const d = document.documentElement;
            if (aj.tema) {
              localStorage.setItem("aura_tema", aj.tema);
              d.classList.toggle("tema-claro", aj.tema === "claro");
            }
            if (aj.accent) {
              localStorage.setItem("aura_accent", aj.accent);
              d.style.setProperty("--accent", aj.accent);
            }
            if (aj.fuente !== undefined) {
              if (aj.fuente) { localStorage.setItem("aura_fuente", aj.fuente); d.setAttribute("data-fuente", aj.fuente); }
              else { localStorage.removeItem("aura_fuente"); d.removeAttribute("data-fuente"); }
            }
          }
        } catch {}
        loadFavorites();
        loadPlaylists();
      } else {
        // Try offline cached session
        const cachedUser = loadOffline("user");
        if (cachedUser) {
          setUser(cachedUser);
          setProfile(loadOffline("profile"));
        }
      }
    } catch {
      // Offline: try cached session
      const cachedUser = loadOffline("user");
      if (cachedUser) {
        setUser(cachedUser);
        setProfile(loadOffline("profile"));
      }
    }
    setLoading(false);
  }

  async function loadFavorites() {
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json();
      if (data.favorites) setFavorites(data.favorites);
    } catch {
      // Offline: already loaded from localStorage
    }
  }

  async function loadPlaylists() {
    try {
      const res = await fetch("/api/playlists");
      const data = await res.json();
      if (data.playlists) setPlaylists(data.playlists);
    } catch {
      // Offline: already loaded from localStorage
    }
  }

  const isFavorite = useCallback((itemType, itemId) => {
    return favorites.some(f => f.item_type === itemType && f.item_id === String(itemId));
  }, [favorites]);

  async function toggleFavorite(itemType, itemId, name, artist, coverUrl, source, extraData) {
    if (!user) return false;
    const isFav = isFavorite(itemType, itemId);

    // Optimistic update (works offline)
    if (isFav) {
      setFavorites(prev => {
        const filtered = prev.filter(f => !(f.item_type === itemType && f.item_id === String(itemId)));
        // Si es álbum, también eliminar todas sus canciones de favoritos
        if (itemType === "album") {
          return filtered.filter(f => !(f.item_type === "track" && (f.extra_data?.album_id === String(itemId) || f.item_id?.startsWith(String(itemId) + "-"))));
        }
        return filtered;
      });
      // También eliminar del offline cache (y todas las canciones si es álbum)
      try {
        const saved = JSON.parse(localStorage.getItem("ml_offline") || "{}");
        if (saved[String(itemId)]) {
          // Si es álbum, eliminar todas las canciones también
          const trackIds = saved[String(itemId)].track_ids || [];
          for (const tid of trackIds) {
            delete saved[tid];
          }
          delete saved[String(itemId)];
          localStorage.setItem("ml_offline", JSON.stringify(saved));
        }
      } catch {}
    } else {
      const newFav = {
        id: "temp-" + Date.now(),
        item_type: itemType,
        item_id: String(itemId),
        name, artist,
        cover_url: coverUrl,
        source: source || "deezer",
        extra_data: extraData || {},
        created_at: new Date().toISOString(),
      };
      setFavorites(prev => [newFav, ...prev]);
    }

    // Cache cover image for offline
    if (coverUrl && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CACHE_URLS",
        urls: [coverUrl],
      });
    }

    // Try to sync with server
    try {
      if (isFav) {
        await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_type: itemType, item_id: String(itemId) }),
        });
        // Si es álbum, también eliminar sus canciones del server
        if (itemType === "album") {
          const trackFavs = favorites.filter(f => f.item_type === "track" && (f.extra_data?.album_id === String(itemId) || f.item_id?.startsWith(String(itemId) + "-")));
          for (const tf of trackFavs) {
            await fetch("/api/favorites", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ item_type: "track", item_id: tf.item_id }),
            }).catch(() => {});
          }
        }
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_type: itemType, item_id: String(itemId), name, artist, cover_url: coverUrl, source: source || "deezer", extra_data: extraData || {} }),
        });
      }
    } catch {
      // Offline: optimistic update already done, will sync when back online
    }
    return !isFav;
  }

  async function createPlaylist(name, description) {
    const tempPl = {
      id: "temp-" + Date.now(),
      name, description,
      cover_url: "",
      is_public: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setPlaylists(prev => [tempPl, ...prev]);

    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (data.playlist) {
        setPlaylists(prev => prev.map(p => p.id === tempPl.id ? data.playlist : p));
        return data.playlist;
      }
    } catch {}
    return tempPl;
  }

  async function addToPlaylist(playlistId, itemType, itemId, name, artist, coverUrl, source) {
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-item",
          playlist_id: playlistId,
          item_type: itemType,
          item_id: String(itemId),
          name, artist,
          cover_url: coverUrl,
          source: source || "deezer",
        }),
      });
      return res.ok;
    } catch { return false; }
  }

  async function logout() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    // Limpiar la caché offline para que la sesión no se restaure sola
    try {
      localStorage.removeItem("ml_offline_user");
      localStorage.removeItem("ml_offline_profile");
      localStorage.removeItem("ml_offline_favorites");
      localStorage.removeItem("ml_offline_playlists");
    } catch {}
    setUser(null);
    setProfile(null);
  }

  return (
    <UserContext.Provider value={{
      user, profile, favorites, playlists, loading,
      isFavorite, toggleFavorite,
      createPlaylist, addToPlaylist,
      loadFavorites, loadPlaylists,
      setUser, setProfile,
      checkSession, logout,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
