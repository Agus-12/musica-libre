"use client";
import { useState } from "react";
import { useUser } from "./UserContext";

export default function AddToPlaylistModal({ item, onClose }) {
  const { playlists, createPlaylist, addToPlaylist, loadPlaylists } = useUser();
  const [showNew, setShowNew] = useState(playlists.length === 0);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState("");
  const [error, setError] = useState("");

  async function handleAdd(playlistId, playlistName) {
    setLoading(true); setError("");
    const ok = await addToPlaylist(playlistId, item.item_type, item.item_id, item.name, item.artist, item.cover_url, item.source);
    if (ok) {
      setAdded(playlistName);
      loadPlaylists();
    } else {
      setError("Error al agregar");
    }
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true); setError("");
    const pl = await createPlaylist(newName.trim(), newDesc.trim());
    if (pl) {
      const ok = await addToPlaylist(pl.id, item.item_type, item.item_id, item.name, item.artist, item.cover_url, item.source);
      if (ok) {
        setAdded(newName.trim());
        loadPlaylists();
      }
    } else {
      setError("Error al crear playlist");
    }
    setLoading(false);
  }

  const IS = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text-strong)", fontSize: "0.95em", outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div style={{ background: "#0f0f1a", borderRadius: 16, padding: 25, maxWidth: 400, width: "100%", border: "1px solid var(--border)", position: "relative" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: "1.2em", marginBottom: 5 }}>➕ Agregar a playlist</h3>
        <p style={{ color: "var(--text3)", fontSize: "0.85em", marginBottom: 15 }}>
          {item.name} — {item.artist}
        </p>

        {added ? (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div style={{ fontSize: "2em", marginBottom: 10 }}>✅</div>
            <p style={{ color: "#22c55e" }}>Agregado a &quot;{added}&quot;</p>
            <button onClick={onClose} style={{ marginTop: 10, padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>OK</button>
          </div>
        ) : (
          <>
            {/* Create new playlist */}
            <button onClick={() => setShowNew(!showNew)} style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px dashed var(--accent)", background: "transparent", color: "var(--accent)", cursor: "pointer", marginBottom: 12, fontSize: "0.9em" }}>
              ✨ Crear nueva playlist
            </button>

            {showNew && (
              <div style={{ background: "var(--panel)", borderRadius: 10, padding: 15, marginBottom: 12, border: "1px solid var(--border)" }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre de la playlist" style={{ ...IS, marginBottom: 8 }} />
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descripción (opcional)" style={IS} />
                <button onClick={handleCreate} disabled={loading || !newName.trim()} style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                  {loading ? "⏳" : "Crear y agregar"}
                </button>
              </div>
            )}

            {/* Existing playlists */}
            {playlists.length > 0 && (
              <div>
                <div style={{ color: "var(--text3)", fontSize: "0.8em", marginBottom: 8 }}>Tus playlists:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                  {playlists.map(pl => (
                    <button key={pl.id} onClick={() => handleAdd(pl.id, pl.name)} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text2)", cursor: "pointer", textAlign: "left" }}>
                      {pl.cover_url ? (
                        <img src={pl.cover_url} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1em" }}>🎵</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.9em" }}>{pl.name}</div>
                        <div style={{ color: "var(--text5)", fontSize: "0.75em" }}>{pl.description || "Sin descripción"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <div style={{ color: "#ef4444", fontSize: "0.85em", marginTop: 8 }}>❌ {error}</div>}
          </>
        )}

        <button onClick={onClose} style={{ position: "absolute", top: 12, right: 15, background: "none", border: "none", color: "var(--text5)", fontSize: "1.3em", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
