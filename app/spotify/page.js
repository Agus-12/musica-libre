"use client";
import { useState } from "react";

export default function SpotifyPage() {
  const [tab, setTab] = useState("search"); // search, url, itunes
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [album, setAlbum] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oembedUrl, setOembedUrl] = useState("");
  const [oembedResult, setOembedResult] = useState(null);
  const [downloading, setDownloading] = useState("");

  // ── Search (auto: Deezer → iTunes fallback) ──
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

  // ── Album detail ──
  async function loadAlbum(albumId, source = "deezer") {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try {
      if (source === "itunes") {
        const res = await fetch("/api/music?action=lookup&id=" + albumId + "&source=itunes");
        const data = await res.json();
        if (data.error) setError(data.error);
        else setAlbum(data);
      } else {
        const res = await fetch("/api/music?action=album&id=" + albumId + "&source=deezer");
        const data = await res.json();
        if (data.error) setError(data.error);
        else setAlbum(data);
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ── Artist detail (Deezer only) ──
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

  // ── oEmbed ──
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

  // ── Download ──
  async function downloadImage(url, filename) {
    setDownloading(filename);
    try {
      const a = document.createElement("a");
      a.href = "/api/download?url=" + encodeURIComponent(url) + "&filename=" + encodeURIComponent(filename);
      a.click();
    } catch {}
    setTimeout(() => setDownloading(""), 2000);
  }

  // ── Styles ──
  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };
  const BS = { padding: "10px 18px", borderRadius: 10, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "0.9em", cursor: "pointer", fontWeight: 600 };
  const SM = { padding: "6px 14px", borderRadius: 6, border: "none", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600 };
  const TabS = (active) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: active ? "#7c5cfc" : "#1a1a2e", color: active ? "#fff" : "#888", fontSize: "0.85em", cursor: "pointer", fontWeight: active ? 700 : 400 });

  const albums = results?.albums || [];
  const artists = results?.artists || [];
  const src = results?.source || "";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "1.8em", marginBottom: 4 }}>
          🎵 Música <span style={{ color: "#1ed760" }}>Libre</span>
        </h1>
        <p style={{ color: "#888", fontSize: "0.9em" }}>
          Buscá y descargá portadas de álbumes — <strong style={{ color: "#22c55e" }}>sin cuenta Premium</strong>, gratis y sin login
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setTab("search"); setAlbum(null); setArtist(null); }} style={TabS(tab === "search" && !album && !artist)}>🔍 Buscar</button>
        <button onClick={() => { setTab("url"); setAlbum(null); setArtist(null); }} style={TabS(tab === "url")}>🔗 URL de Spotify</button>
        <button onClick={() => { setTab("itunes"); setAlbum(null); setArtist(null); }} style={TabS(tab === "itunes")}>🍎 iTunes</button>
      </div>

      {/* ── TAB: Search ── */}
      {tab === "search" && !album && !artist && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="Buscar álbumes, artistas... (ej: Bad Bunny, Rosalía)"
              style={{ ...IS, flex: 1, minWidth: 200 }}
            />
            <button onClick={search} disabled={loading} style={BS}>
              {loading ? "⏳" : "🔍 Buscar"}
            </button>
          </div>

          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}

          {!loading && results && (
            <div>
              <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: "0.75em", marginBottom: 15, background: src === "deezer" ? "#1a2e1a" : "#2e1a1a", color: src === "deezer" ? "#22c55e" : "#ef4444", border: `1px solid ${src === "deezer" ? "#2a4a2a" : "#4a2a2a"}` }}>
                Fuente: {src === "deezer" ? "🟢 Deezer (portadas 1400px)" : "🍎 iTunes (portadas 600px)"}
              </div>

              {artists.length > 0 && (
                <div style={{ marginBottom: 25 }}>
                  <h3 style={{ color: "#1ed760", marginBottom: 12 }}>🎤 Artistas</h3>
                  <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10 }}>
                    {artists.map(a => (
                      <div key={a.id} onClick={() => a.source === "deezer" ? loadArtist(a.id) : null} style={{ flex: "0 0 120px", background: "#1a1a2e", borderRadius: 12, padding: 12, textAlign: "center", cursor: a.source === "deezer" ? "pointer" : "default", border: "1px solid #2a2a3e" }}>
                        {a.picture_medium ? (
                          <img src={a.picture_medium} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", marginBottom: 6 }} />
                        ) : (
                          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#2a2a3e", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>🎤</div>
                        )}
                        <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                        {a.nb_album > 0 && <div style={{ color: "#555", fontSize: "0.7em" }}>{a.nb_album} álbumes</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {albums.length > 0 && (
                <div>
                  <h3 style={{ color: "#1ed760", marginBottom: 12 }}>💿 Álbumes</h3>
                  <AlbumGrid albums={albums} onSelect={(id) => loadAlbum(id, src)} />
                </div>
              )}

              {!loading && results && albums.length === 0 && artists.length === 0 && (
                <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados 😕</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Spotify URL (oEmbed) ── */}
      {tab === "url" && !album && !artist && (
        <div>
          <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 15 }}>
            Pegá cualquier URL de Spotify (álbum, canción, playlist, artista) y te saco la portada:
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input
              value={oembedUrl}
              onChange={e => setOembedUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && resolveOEmbed()}
              placeholder="https://open.spotify.com/intl-es/album/3RQQmkQEvNCY4prGKE6oc5"
              style={{ ...IS, flex: 1, minWidth: 200 }}
            />
            <button onClick={resolveOEmbed} disabled={loading} style={BS}>
              {loading ? "⏳" : "🔗 Obtener info"}
            </button>
          </div>

          <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12, marginBottom: 15, border: "1px solid #2a2a3e" }}>
            <div style={{ color: "#888", fontSize: "0.8em", marginBottom: 6 }}>Ejemplos (click para usar):</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "Bad Bunny — Un Verano Sin Ti", url: "https://open.spotify.com/album/3RQQmkQEvNCY4prGKE6oc5" },
                { label: "Rosalía — MOTOMAMI", url: "https://open.spotify.com/album/4LmHcKEDVYyLmGIEzSCVaD" },
                { label: "Playlist: Today's Top Hits", url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBMwM" },
              ].map(ex => (
                <button key={ex.url} onClick={() => setOembedUrl(ex.url)} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", textAlign: "left", fontSize: "0.8em", padding: "3px 0" }}>
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}

          {oembedResult && !loading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, border: "1px solid #2a2a3e" }}>
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
                <img
                  src={oembedResult.thumbnail_large || oembedResult.thumbnail}
                  style={{ width: 200, height: 200, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h2 style={{ fontSize: "1.3em", marginBottom: 5 }}>{oembedResult.title}</h2>
                  <p style={{ color: "#1ed760", marginBottom: 10 }}>{oembedResult.provider}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {oembedResult.thumbnail_large && (
                      <button onClick={() => downloadImage(oembedResult.thumbnail_large, oembedResult.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_large.jpg")} style={{ ...SM, background: "#22c55e" }}>
                        ⬇️ Grande
                      </button>
                    )}
                    {oembedResult.thumbnail && (
                      <button onClick={() => downloadImage(oembedResult.thumbnail, oembedResult.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_thumb.jpg")} style={{ ...SM, background: "#3b82f6" }}>
                        ⬇️ Miniatura
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {oembedResult.html && (
                <div style={{ borderRadius: 12, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: oembedResult.html.replace(/height="\d+"/, 'height="352"') }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: iTunes ── */}
      {tab === "itunes" && !album && !artist && (
        <div>
          <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 15 }}>
            Búsqueda con iTunes — portadas hasta 600px, sin login:
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchITunes()}
              placeholder="Buscar en iTunes..."
              style={{ ...IS, flex: 1, minWidth: 200 }}
            />
            <button onClick={searchITunes} disabled={loading} style={{ ...BS, background: "#ef4444" }}>
              {loading ? "⏳" : "🍎 Buscar iTunes"}
            </button>
          </div>

          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}

          {!loading && results && results.source === "itunes" && (
            <div>
              {albums.length > 0 ? (
                <div>
                  <h3 style={{ color: "#ef4444", marginBottom: 12 }}>💿 Álbumes (iTunes)</h3>
                  <AlbumGrid albums={albums} onSelect={(id) => loadAlbum(id, "itunes")} />
                </div>
              ) : (
                <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Album Detail View ── */}
      {album && !loading && (
        <div>
          <button onClick={() => setAlbum(null)} style={{ ...SM, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 25, alignItems: "flex-start", flexWrap: "wrap" }}>
            <img
              src={album.cover_xl || album.cover_big || album.cover_medium}
              style={{ width: 250, height: 250, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
            />
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{album.name}</h2>
              {album.artist_id && album.source === "deezer" ? (
                <p style={{ color: "#1ed760", marginBottom: 5, cursor: "pointer" }} onClick={() => { setAlbum(null); loadArtist(album.artist_id); }}>{album.artist}</p>
              ) : (
                <p style={{ color: "#1ed760", marginBottom: 5 }}>{album.artist}</p>
              )}
              <p style={{ color: "#888", marginBottom: 3 }}>
                {album.release_date || album.year}
                {album.total_tracks ? ` — ${album.total_tracks} canciones` : ""}
                {album.track_count ? ` — ${album.track_count} canciones` : ""}
              </p>
              {album.label && <p style={{ color: "#555", fontSize: "0.85em", marginBottom: 3 }}>Sello: {album.label}</p>}
              {album.genres?.length > 0 && <p style={{ color: "#555", fontSize: "0.85em", marginBottom: 8 }}>Géneros: {album.genres.join(", ")}</p>}
              {album.genre && <p style={{ color: "#555", fontSize: "0.85em", marginBottom: 8 }}>Género: {album.genre}</p>}

              {/* Download buttons */}
              {album.images?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#888", fontSize: "0.8em", marginBottom: 6 }}>⬇️ Descargar portada:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {album.images.map((img, i) => (
                      <button key={i} onClick={() => downloadImage(img.url, album.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")}
                        style={{ ...SM, background: i === 0 ? "#22c55e" : "#3b82f6" }}>
                        ⬇️ {img.label || img.size}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Fallback for albums without images array */}
              {(album.cover_xl || album.cover_big) && !album.images?.length && (
                <button onClick={() => downloadImage(album.cover_xl || album.cover_big, album.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_cover.jpg")}
                  style={{ ...SM, background: "#22c55e", marginTop: 12 }}>
                  ⬇️ Descargar portada
                </button>
              )}
            </div>
          </div>

          {/* Deezer embed */}
          {album.source === "deezer" && album.id && (
            <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
              <iframe
                src={"https://www.deezer.com/widgets/album?id=" + album.id + "&layout=dark&tracklist=true"}
                width="100%" height="380" frameBorder="0" allowTransparency="true"
                style={{ borderRadius: 12 }}
              />
            </div>
          )}

          {/* Track list */}
          {album.tracks?.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎶 Canciones</h3>
              <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
                {album.tracks.map((track, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 15px", borderBottom: "1px solid #2a2a3e" }}>
                    <span style={{ color: "#555", width: 25, textAlign: "right", fontSize: "0.85em" }}>{track.number || i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#e0e0e0", fontSize: "0.95em" }}>{track.name}</div>
                      {track.artist && track.artist !== album.artist && <div style={{ color: "#666", fontSize: "0.8em" }}>{track.artist}</div>}
                    </div>
                    {track.duration && <span style={{ color: "#555", fontSize: "0.85em" }}>{track.duration}</span>}
                    {track.preview_url && (
                      <button onClick={() => {
                        const audio = document.getElementById("preview-" + i);
                        if (audio.paused) { audio.play(); } else { audio.pause(); audio.currentTime = 0; }
                      }} style={{ ...SM, background: "#3b82f6", padding: "4px 10px", fontSize: "0.75em" }}>
                        ▶️<audio id={"preview-" + i} src={track.preview_url} preload="none" onEnded={e => e.target.currentTime = 0} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Artist Detail View ── */}
      {artist && !loading && (
        <div>
          <button onClick={() => setArtist(null)} style={{ ...SM, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {artist.picture_xl ? (
              <img src={artist.picture_xl} style={{ width: 180, height: 180, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
            ) : (
              <div style={{ width: 180, height: 180, borderRadius: "50%", background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "4em" }}>🎤</div>
            )}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{artist.name}</h2>
              {artist.nb_fans > 0 && <p style={{ color: "#888", marginBottom: 8 }}>{artist.nb_fans.toLocaleString()} fans</p>}
              {artist.images?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {artist.images.map((img, i) => (
                    <button key={i} onClick={() => downloadImage(img.url, artist.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")}
                      style={{ ...SM, background: i === 0 ? "#22c55e" : "#3b82f6" }}>
                      ⬇️ {img.label || img.size}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {artist.albums?.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 12 }}>💿 Álbumes ({artist.nb_album || artist.albums.length})</h3>
              <AlbumGrid albums={artist.albums} onSelect={(id) => loadAlbum(id, "deezer")} />
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── iTunes search helper ──
  function searchITunes() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setResults(null);
    fetch("/api/music?action=search&q=" + encodeURIComponent(query) + "&source=itunes&entity=album&limit=20")
      .then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setResults(data); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
}

// ── Sub-components ──

function AlbumGrid({ albums, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e", transition: "transform 0.15s" }}
          onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"}
          onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ padding: "8px 10px" }}>
            <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorMsg({ error }) {
  return (
    <div style={{ background: "#2e1a1a", border: "1px solid #5a2a2a", borderRadius: 10, padding: 15, marginBottom: 15 }}>
      <div style={{ color: "#ef4444", fontWeight: 600, marginBottom: 5 }}>❌ Error</div>
      <div style={{ color: "#ccc", fontSize: "0.9em" }}>{error}</div>
    </div>
  );
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 40, color: "#1ed760", fontSize: "1.1em" }}>⏳ Cargando...</div>;
}
