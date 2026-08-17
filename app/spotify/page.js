"use client";
import { useState, useEffect } from "react";

/* ═══════════════════════════════════════════════════
   SPOTIFY EXPLORER v2 — Better error handling
   ═══════════════════════════════════════════════════ */

export default function SpotifyPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured] = useState(false);
  const [view, setView] = useState("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [album, setAlbum] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem("spotify_creds");
    if (saved) {
      try {
        const { id, secret } = JSON.parse(saved);
        if (id && secret) {
          setClientId(id);
          setClientSecret(secret);
          setConfigured(true);
        }
      } catch {}
    }
  }, []);

  function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    localStorage.setItem("spotify_creds", JSON.stringify({ id: clientId.trim(), secret: clientSecret.trim() }));
    setConfigured(true);
    setError("");
  }

  async function testCredentials() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/spotify?client_id=${encodeURIComponent(clientId.trim())}&client_secret=${encodeURIComponent(clientSecret.trim())}&action=new-releases&limit=1`);
      const data = await res.json();
      if (data.error) {
        setTestResult({ ok: false, msg: data.error });
      } else {
        setTestResult({ ok: true, msg: "✅ ¡Funciona! Spotify respondió correctamente." });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  }

  function apiBase() {
    return `/api/spotify?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  }

  async function search() {
    if (!query) return;
    setLoading(true); setError(""); setView("search");
    try {
      const res = await fetch(`${apiBase()}&action=search&q=${encodeURIComponent(query)}&type=album,artist&limit=20`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults(data);
    } catch (e) { setError("Error de conexión: " + e.message); }
    setLoading(false);
  }

  async function loadAlbum(id) {
    setLoading(true); setError(""); setAlbum(null); setView("album");
    try {
      const res = await fetch(`${apiBase()}&action=album&id=${id}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAlbum(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadArtist(id) {
    setLoading(true); setError(""); setArtist(null); setView("artist");
    try {
      const [ar, al] = await Promise.all([
        fetch(`${apiBase()}&action=artist&id=${id}`).then(r => r.json()),
        fetch(`${apiBase()}&action=artist-albums&id=${id}&limit=20`).then(r => r.json()),
      ]);
      if (ar.error) setError(ar.error);
      else setArtist({ ...ar, albums: al.items || [] });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function loadNewReleases() {
    setLoading(true); setError(""); setView("new");
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
          Para buscar y descargar imágenes de álbumes, necesitás una app gratuita de Spotify:
        </p>

        <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #2a2a3e" }}>
          <h3 style={{ color: "#1ed760", marginBottom: 12 }}>📋 Pasos (2 minutos):</h3>
          <ol style={{ color: "#aaa", lineHeight: 2.2, paddingLeft: 20, fontSize: "0.9em" }}>
            <li>Andá a <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener" style={{ color: "#1ed760", fontWeight: 600 }}>developer.spotify.com/dashboard</a></li>
            <li>Iniciá sesión con tu cuenta de Spotify (la misma que usás normalmente)</li>
            <li>Click en <strong style={{ color: "#e0e0e0" }}>"Create App"</strong></li>
            <li>
              Llená los campos:
              <div style={{ background: "#0f0f1a", borderRadius: 8, padding: 12, marginTop: 8, fontSize: "0.85em" }}>
                <div><strong style={{ color: "#1ed760" }}>App name:</strong> <code style={codeStyle}>Mirror Downloader</code></div>
                <div><strong style={{ color: "#1ed760" }}>Description:</strong> <code style={codeStyle}>Descargar imágenes</code></div>
                <div><strong style={{ color: "#1ed760" }}>Redirect URI:</strong> <code style={codeStyle}>http://127.0.0.1:3000/callback</code></div>
                <div><strong style={{ color: "#1ed760" }}>API/SDKs:</strong> marcá <strong>Web API</strong></div>
              </div>
            </li>
            <li>Click <strong style={{ color: "#e0e0e0" }}>"Save"</strong></li>
            <li>Copiá el <strong style={{ color: "#1ed760" }}>Client ID</strong> y <strong style={{ color: "#1ed760" }}>Client Secret</strong></li>
          </ol>
          <p style={{ color: "#666", fontSize: "0.8em", marginTop: 10 }}>
            💡 Si "Redirect URI" da error, probá con: <code style={codeStyle}>https://example.com/callback</code>
          </p>
        </div>

        <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 20, border: "1px solid #2a2a3e" }}>
          <h3 style={{ color: "#7c5cfc", marginBottom: 12 }}>🔑 Pegá tus credenciales:</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 15 }}>
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 4, display: "block" }}>Client ID</label>
              <input placeholder="Ej: a1b2c3d4e5f6..." value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 4, display: "block" }}>Client Secret</label>
              <input placeholder="Ej: 9z8y7x6w..." value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={testCredentials} disabled={testing || !clientId || !clientSecret} style={{ ...btnStyle, background: "#3b82f6" }}>
              {testing ? "⏳ Probando..." : "🧪 Probar conexión"}
            </button>
            <button onClick={saveCredentials} disabled={!clientId || !clientSecret} style={btnStyle}>
              ✅ Guardar y empezar
            </button>
          </div>
          {testResult && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: testResult.ok ? "#1a2e1a" : "#2e1a1a", color: testResult.ok ? "#22c55e" : "#ef4444", fontSize: "0.9em" }}>
              {testResult.msg}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── MAIN APP ──
  const albums = results?.albums?.items || [];
  const artists = results?.artists?.items || [];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.5em" }}>🎵 Spotify <span style={{ color: "#1ed760" }}>Downloader</span></h1>
        <button onClick={() => { setConfigured(false); setTestResult(null); }} style={{ ...btnSm, background: "#555", marginLeft: "auto" }}>⚙️ Config</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas..." style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <button onClick={search} disabled={loading} style={btnStyle}>🔍 Buscar</button>
        <button onClick={loadNewReleases} disabled={loading} style={{ ...btnStyle, background: "#1ed760", color: "#000" }}>🆕 Nuevos</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#1ed760" }}>⏳ Cargando...</div>}
      {error && (
        <div style={{ background: "#2e1a1a", border: "1px solid #5a2a2a", borderRadius: 10, padding: 15, marginBottom: 15 }}>
          <div style={{ color: "#ef4444", fontWeight: 600, marginBottom: 5 }}>❌ Error</div>
          <div style={{ color: "#ccc", fontSize: "0.9em" }}>{error}</div>
          <div style={{ color: "#888", fontSize: "0.8em", marginTop: 8 }}>
            💡 Verificá tu Client ID y Client Secret en <a href="https://developer.spotify.com/dashboard" target="_blank" style={{ color: "#1ed760" }}>developer.spotify.com</a>
          </div>
        </div>
      )}

      {/* ARTIST VIEW */}
      {view === "artist" && artist && !loading && (
        <div>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {artist.images?.[0] && <img src={artist.images[0].url} style={{ width: 180, height: 180, borderRadius: 12, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{artist.name}</h2>
              <p style={{ color: "#888", marginBottom: 8 }}>{artist.followers?.total?.toLocaleString()} seguidores · {artist.genres?.join(", ")}</p>
              {artist.images?.length > 0 && (
                <button onClick={() => downloadAllImages(artist.images.map(img => ({ url: img.url, size: `${img.width}x${img.height}` })), artist.name.replace(/\s+/g, "_"))} style={{ ...btnSm, background: "#22c55e" }}>
                  ⬇️ Descargar fotos ({artist.images.length})
                </button>
              )}
            </div>
          </div>
          <h3 style={{ color: "#1ed760", marginBottom: 15 }}>Álbumes</h3>
          <AlbumGrid albums={artist.albums} onSelect={loadAlbum} />
        </div>
      )}

      {/* ALBUM VIEW */}
      {view === "album" && album && !loading && (
        <div>
          <button onClick={() => { setView("search"); setAlbum(null); }} style={{ ...btnSm, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 25, alignItems: "flex-start", flexWrap: "wrap" }}>
            {album.images?.[0] && <img src={album.images[0].url} style={{ width: 220, height: 220, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{album.name}</h2>
              <p style={{ color: "#1ed760", marginBottom: 5, cursor: "pointer" }} onClick={() => loadArtist(album.artists?.[0]?.id)}>
                {album.artists?.map(a => a.name).join(", ")}
              </p>
              <p style={{ color:"#888", marginBottom: 3 }}>{album.release_date} · {album.total_tracks} canciones</p>
              {album.images?.length > 0 && (
                <button onClick={() => downloadAllImages(album.images.map(img => ({ url: img.url, size: `${img.width}x${img.height}` })), album.name.replace(/\s+/g, "_"))} style={{ ...btnSm, background: "#22c55e", marginTop: 8 }}>
                  ⬇️ Descargar portada ({album.images.length} resoluciones)
                </button>
              )}
            </div>
          </div>
          <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
            <iframe src={`https://open.spotify.com/embed/album/${album.id}?utm_source=generator&theme=0`} width="100%" height="352" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style={{ borderRadius: 12 }} />
          </div>
          <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎶 Canciones</h3>
          <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
            {album.tracks?.items?.map((track, i) => (
              <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 15px", borderBottom: "1px solid #2a2a3e" }}>
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

      {/* SEARCH / NEW RELEASES */}
      {(view === "search" || view === "new") && !loading && (
        <div>
          {artists.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎤 Artistas</h3>
              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10, marginBottom: 10 }}>
                {artists.map(a => (
                  <div key={a.id} onClick={() => loadArtist(a.id)} style={{ flex: "0 0 130px", background: "#1a1a2e", borderRadius: 12, padding: 12, textAlign: "center", cursor: "pointer", border: "1px solid #2a2a3e" }}>
                    {a.images?.[0] ? <img src={a.images[0].url} style={{ width: 90, height: 90, borderRadius: "50%", objectFit: "cover", marginBottom: 6 }} /> : <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#2a2a3e", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>🎤</div>}
                    <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600 }}>{a.name}</div>
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
            <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados. Probá con otro nombre.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AlbumGrid({ albums, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e" }}>
          {a.images?.[0] ? <img src={a.images[0].url} style={{ width: "100%", aspectRatio: 1, objectFit: "cover" }} loading="lazy" /> : <div style={{ width: "100%", aspectRatio: 1, background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3em" }}>💿</div>}
          <div style={{ padding: "8px 10px" }}>
            <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artists?.map(a => a.name).join(", ")}</div>
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

const inputStyle = { padding: "12px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "1em", outline: "none", width: "100%" };
const btnStyle = { padding: "10px 18px", borderRadius: 10, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "0.9em", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" };
const btnSm = { padding: "6px 14px", borderRadius: 6, border: "none", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600 };
const codeStyle = { background: "#0f0f1a", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace", fontSize: "0.9em" };
