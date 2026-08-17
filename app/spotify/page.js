"use client";
import { useState, useEffect } from "react";

/* ═══════════════════════════════════════════════════
   SPOTIFY EXPLORER — Buscar, navegar y descargar
   ═══════════════════════════════════════════════════ */

export default function SpotifyPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured] = useState(false);
  const [view, setView] = useState("search"); // search | album | artist | new
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [album, setAlbum] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load saved credentials
  useEffect(() => {
    const saved = localStorage.getItem("spotify_creds");
    if (saved) {
      const { id, secret } = JSON.parse(saved);
      setClientId(id);
      setClientSecret(secret);
      setConfigured(true);
    }
  }, []);

  function saveCredentials() {
    if (!clientId || !clientSecret) return;
    localStorage.setItem("spotify_creds", JSON.stringify({ id: clientId, secret: clientSecret }));
    setConfigured(true);
  }

  function apiBase() {
    return `/api/spotify?client_id=${clientId}&client_secret=${clientSecret}`;
  }

  async function search() {
    if (!query) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}&action=search&q=${encodeURIComponent(query)}&type=album,artist&limit=20`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadAlbum(id) {
    setLoading(true);
    setError("");
    setAlbum(null);
    setView("album");
    try {
      const res = await fetch(`${apiBase()}&action=album&id=${id}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAlbum(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadArtist(id) {
    setLoading(true);
    setError("");
    setArtist(null);
    setView("artist");
    try {
      const [artistRes, albumsRes] = await Promise.all([
        fetch(`${apiBase()}&action=artist&id=${id}`),
        fetch(`${apiBase()}&action=artist-albums&id=${id}&limit=20`),
      ]);
      const artistData = await artistRes.json();
      const albumsData = await albumsRes.json();
      if (artistData.error) setError(artistData.error);
      else setArtist({ ...artistData, albums: albumsData.items || [] });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadNewReleases() {
    setLoading(true);
    setError("");
    setView("new");
    try {
      const res = await fetch(`${apiBase()}&action=new-releases&limit=20`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults({ albums: data.albums });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  function downloadImage(url, filename) {
    const a = document.createElement("a");
    a.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    a.click();
  }

  function downloadAllImages(images, prefix) {
    images.forEach((img, i) => {
      setTimeout(() => downloadImage(img.url, `${prefix}_${img.size || i}.jpg`), i * 500);
    });
  }

  // ── SETUP SCREEN ──
  if (!configured) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: 30 }}>
        <h1 style={{ fontSize: "2em", marginBottom: 8 }}>🎵 Spotify <span style={{ color: "#1ed760" }}>Downloader</span></h1>
        <p style={{ color: "#888", marginBottom: 25, lineHeight: 1.6 }}>
          Para usar esta app, necesitás crear una app gratuita en Spotify:
        </p>
        <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #2a2a3e" }}>
          <h3 style={{ color: "#1ed760", marginBottom: 12 }}>📋 Pasos (2 minutos):</h3>
          <ol style={{ color: "#aaa", lineHeight: 2, paddingLeft: 20 }}>
            <li>Andá a <a href="https://developer.spotify.com/dashboard" target="_blank" style={{ color: "#1ed760" }}>developer.spotify.com/dashboard</a></li>
            <li>Iniciá sesión con tu cuenta de Spotify</li>
            <li>Click <strong>"Create App"</strong></li>
            <li>Poné nombre: <code style={{ background: "#2a2a3e", padding: "2px 6px", borderRadius: 4 }}>Mirror Downloader</code></li>
            <li>En Redirect URI poné: <code style={{ background: "#2a2a3e", padding: "2px 6px", borderRadius: 4, fontSize: "0.85em" }}>http://localhost</code></li>
            <li>Seleccioná <strong>Web API</strong> → Click <strong>Save</strong></li>
            <li>Copiá el <strong>Client ID</strong> y <strong>Client Secret</strong></li>
          </ol>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          <input placeholder="Client ID" value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle} />
          <input placeholder="Client Secret" value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password" style={inputStyle} />
          <button onClick={saveCredentials} disabled={!clientId || !clientSecret} style={btnStyle}>✅ Guardar y empezar</button>
        </div>
      </div>
    );
  }

  // ── MAIN APP ──
  const albums = results?.albums?.items || [];
  const artists = results?.artists?.items || [];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.5em" }}>🎵 Spotify <span style={{ color: "#1ed760" }}>Downloader</span></h1>
        <button onClick={() => { setConfigured(false); }} style={{ ...btnSm, background: "#555", marginLeft: "auto" }}>⚙️ Config</button>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas..." style={{ ...inputStyle, flex: 1 }} />
        <button onClick={search} disabled={loading} style={btnStyle}>🔍</button>
        <button onClick={loadNewReleases} disabled={loading} style={{ ...btnStyle, background: "#1ed760", color: "#000" }}>🆕 Nuevos</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#1ed760" }}>⏳ Cargando...</div>}
      {error && <div style={{ color: "#ef4444", padding: 10, marginBottom: 15 }}>❌ {error}</div>}

      {/* ARTIST VIEW */}
      {view === "artist" && artist && !loading && (
        <div>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {artist.images?.[0] && <img src={artist.images[0].url} style={{ width: 180, height: 180, borderRadius: 12, objectFit: "cover" }} />}
            <div>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{artist.name}</h2>
              <p style={{ color: "#888" }}>{artist.followers?.total?.toLocaleString()} seguidores · {artist.genres?.join(", ")}</p>
              <button onClick={() => downloadAllImages(artist.images.map((img, i) => ({ url: img.url, size: `${img.width}x${img.height}` })), artist.name.replace(/\s+/g, "_"))} style={{ ...btnSm, background: "#22c55e", marginTop: 10 }}>⬇️ Descargar fotos</button>
            </div>
          </div>
          <h3 style={{ color: "#1ed760", marginBottom: 15 }}>Álbumes</h3>
          <AlbumGrid albums={artist.albums} onSelect={loadAlbum} />
        </div>
      )}

      {/* ALBUM VIEW */}
      {view === "album" && album && !loading && (
        <div>
          <button onClick={() => setView("search")} style={{ ...btnSm, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 25, alignItems: "flex-start", flexWrap: "wrap" }}>
            {album.images?.[0] && <img src={album.images[0].url} style={{ width: 220, height: 220, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{album.name}</h2>
              <p style={{ color: "#1ed760", marginBottom: 5, cursor: "pointer" }} onClick={() => loadArtist(album.artists?.[0]?.id)}>
                {album.artists?.map(a => a.name).join(", ")}
              </p>
              <p style={{ color: "#888", marginBottom: 3 }}>{album.release_date} · {album.total_tracks} canciones</p>
              <p style={{ color: "#555", fontSize: "0.85em", marginBottom: 10 }}>🔗 {album.external_urls?.spotify}</p>
              <button onClick={() => downloadAllImages(album.images.map((img, i) => ({ url: img.url, size: `${img.width}x${img.height}` })), album.name.replace(/\s+/g, "_"))} style={{ ...btnSm, background: "#22c55e", marginRight: 8 }}>⬇️ Descargar portada (todas las resoluciones)</button>
            </div>
          </div>

          {/* Embed player */}
          <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
            <iframe src={`https://open.spotify.com/embed/album/${album.id}?utm_source=generator&theme=0`} width="100%" height="352" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style={{ borderRadius: 12 }} />
          </div>

          {/* Track list */}
          <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎶 Canciones</h3>
          <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
            {album.tracks?.items?.map((track, i) => (
              <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 15px", borderBottom: "1px solid #2a2a3e", cursor: "pointer" }} onClick={() => window.open(track.external_urls?.spotify, "_blank")}>
                <span style={{ color: "#555", width: 25, textAlign: "right", fontSize: "0.85em" }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#e0e0e0", fontSize: "0.95em" }}>{track.name}</div>
                  <div style={{ color: "#666", fontSize: "0.8em" }}>{track.artists?.map(a => a.name).join(", ")}</div>
                </div>
                <span style={{ color: "#555", fontSize: "0.85em" }}>{msToMin(track.duration_ms)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SEARCH / NEW RELEASES VIEW */}
      {(view === "search" || view === "new") && !loading && (
        <div>
          {artists.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎤 Artistas</h3>
              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 15, marginBottom: 15 }}>
                {artists.map(a => (
                  <div key={a.id} onClick={() => loadArtist(a.id)} style={{ flex: "0 0 140px", background: "#1a1a2e", borderRadius: 12, padding: 15, textAlign: "center", cursor: "pointer", border: "1px solid #2a2a3e" }}>
                    {a.images?.[0] ? <img src={a.images[0].url} style={{ width: 100, height: 100, borderRadius: "50%", objectFit: "cover", marginBottom: 8 }} /> : <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#2a2a3e", margin: "0 auto 8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>🎤</div>}
                    <div style={{ color: "#ccc", fontSize: "0.85em", fontWeight: 600 }}>{a.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {albums.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 10 }}>💿 Álbumes</h3>
              <AlbumGrid albums={albums} onSelect={loadAlbum} />
            </div>
          )}
          {!loading && results && albums.length === 0 && artists.length === 0 && (
            <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados</p>
          )}
        </div>
      )}
    </div>
  );
}

function AlbumGrid({ albums, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e", transition: "transform 0.2s" }}>
          {a.images?.[0] ? <img src={a.images[0].url} style={{ width: "100%", aspectRatio: 1, objectFit: "cover" }} loading="lazy" /> : <div style={{ width: "100%", aspectRatio: 1, background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3em" }}>💿</div>}
          <div style={{ padding: "10px 12px" }}>
            <div style={{ color: "#ccc", fontSize: "0.85em", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.75em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artists?.map(a => a.name).join(", ")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function msToMin(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const inputStyle = { padding: "12px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "1em", outline: "none" };
const btnStyle = { padding: "12px 20px", borderRadius: 10, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" };
const btnSm = { padding: "6px 14px", borderRadius: 6, border: "none", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600 };
