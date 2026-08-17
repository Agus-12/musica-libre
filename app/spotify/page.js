"use client";
import { useState, useEffect } from "react";
import { useUser } from "../components/UserContext";
import AddToPlaylistModal from "../components/AddToPlaylistModal";

export default function SpotifyPage() {
  const { user, isFavorite, toggleFavorite, checkSession } = useUser();
  const [playlistModal, setPlaylistModal] = useState(null); // item to add to playlist
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [album, setAlbum] = useState(null);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oembedUrl, setOembedUrl] = useState("");
  const [oembedResult, setOembedResult] = useState(null);
  const [downloading, setDownloading] = useState("");

  // Handle URL params for deep links from profile
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const albumId = params.get("album");
    const artistId = params.get("artist");
    const source = params.get("source") || "deezer";
    if (albumId) loadAlbum(albumId, source);
    else if (artistId) loadArtist(artistId);
  }, []);

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

  async function loadAlbum(albumId, source = "deezer") {
    setLoading(true); setError(""); setAlbum(null); setArtist(null);
    try {
      const endpoint = source === "itunes"
        ? "/api/music?action=lookup&id=" + albumId + "&source=itunes"
        : "/api/music?action=album&id=" + albumId + "&source=deezer";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAlbum(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

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

  async function downloadImage(url, filename) {
    setDownloading(filename);
    try {
      const a = document.createElement("a");
      a.href = "/api/download?url=" + encodeURIComponent(url) + "&filename=" + encodeURIComponent(filename);
      a.click();
    } catch {}
    setTimeout(() => setDownloading(""), 2000);
  }

  function handleFavorite(e, itemType, itemId, name, artistName, coverUrl, source) {
    e.stopPropagation();
    if (!user) { setShowAuth(true); return; }
    toggleFavorite(itemType, String(itemId), name, artistName, coverUrl, source);
  }

  function handleAddToPlaylist(e, itemType, itemId, name, artistName, coverUrl, source) {
    e.stopPropagation();
    if (!user) { setShowAuth(true); return; }
    setPlaylistModal({ item_type: itemType, item_id: String(itemId), name, artist: artistName, cover_url: coverUrl, source });
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
      
      {playlistModal && <AddToPlaylistModal item={playlistModal} onClose={() => setPlaylistModal(null)} />}

      {/* Info */}
      <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 20 }}>
        Buscá y descargá portadas — <strong style={{ color: "#22c55e" }}>sin Premium</strong>, gratis
        {user && <span> • <a href="/profile" style={{ color: "#7c5cfc" }}>Mi perfil</a></span>}
      </p>

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
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Buscar álbumes, artistas... (ej: Bad Bunny, Rosalía)" style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={search} disabled={loading} style={BS}>{loading ? "⏳" : "🔍 Buscar"}</button>
          </div>
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {!loading && results && (
            <div>
              <SourceBadge source={src} />
              {artists.length > 0 && (
                <div style={{ marginBottom: 25 }}>
                  <h3 style={{ color: "#1ed760", marginBottom: 12 }}>🎤 Artistas</h3>
                  <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10 }}>
                    {artists.map(a => (
                      <div key={a.id} onClick={() => a.source === "deezer" ? loadArtist(a.id) : null} style={{ flex: "0 0 120px", background: "#1a1a2e", borderRadius: 12, padding: 12, textAlign: "center", cursor: "pointer", border: "1px solid #2a2a3e", position: "relative" }}>
                        <button onClick={e => handleFavorite(e, "artist", a.id, a.name, "", a.picture_medium, a.source || "deezer")} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", fontSize: "0.8em" }}>
                          {isFavorite("artist", a.id) ? "❤️" : "🤍"}
                        </button>
                        {a.picture_medium ? <img src={a.picture_medium} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", marginBottom: 6 }} /> : <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#2a2a3e", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>🎤</div>}
                        <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {albums.length > 0 && (
                <div>
                  <h3 style={{ color: "#1ed760", marginBottom: 12 }}>💿 Álbumes</h3>
                  <AlbumGrid albums={albums} source={src} onSelect={(id) => loadAlbum(id, src)} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
                </div>
              )}
              {!loading && results && albums.length === 0 && artists.length === 0 && <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados 😕</p>}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: URL ── */}
      {tab === "url" && !album && !artist && (
        <div>
          <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 15 }}>Pegá cualquier URL de Spotify (álbum, canción, playlist, artista):</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input value={oembedUrl} onChange={e => setOembedUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && resolveOEmbed()} placeholder="https://open.spotify.com/intl-es/album/3RQQmkQEvNCY4prGKE6oc5" style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={resolveOEmbed} disabled={loading} style={BS}>{loading ? "⏳" : "🔗 Obtener info"}</button>
          </div>
          <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12, marginBottom: 15, border: "1px solid #2a2a3e" }}>
            <div style={{ color: "#888", fontSize: "0.8em", marginBottom: 6 }}>Ejemplos:</div>
            {[
              { label: "Bad Bunny — Un Verano Sin Ti", url: "https://open.spotify.com/album/3RQQmkQEvNCY4prGKE6oc5" },
              { label: "Rosalía — MOTOMAMI", url: "https://open.spotify.com/album/4LmHcKEDVYyLmGIEzSCVaD" },
            ].map(ex => (
              <button key={ex.url} onClick={() => setOembedUrl(ex.url)} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", textAlign: "left", fontSize: "0.8em", padding: "3px 0", display: "block" }}>{ex.label}</button>
            ))}
          </div>
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {oembedResult && !loading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, border: "1px solid #2a2a3e" }}>
              <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
                <img src={oembedResult.thumbnail_large || oembedResult.thumbnail} style={{ width: 200, height: 200, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h2 style={{ fontSize: "1.3em", marginBottom: 5 }}>{oembedResult.title}</h2>
                  <p style={{ color: "#1ed760", marginBottom: 10 }}>{oembedResult.provider}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {oembedResult.thumbnail_large && <button onClick={() => downloadImage(oembedResult.thumbnail_large, oembedResult.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_large.jpg")} style={{ ...SM, background: "#22c55e" }}>⬇️ Grande</button>}
                    {oembedResult.thumbnail && <button onClick={() => downloadImage(oembedResult.thumbnail, oembedResult.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_thumb.jpg")} style={{ ...SM, background: "#3b82f6" }}>⬇️ Miniatura</button>}
                  </div>
                </div>
              </div>
              {oembedResult.html && <div style={{ borderRadius: 12, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: oembedResult.html.replace(/height="\d+"/, 'height="352"') }} />}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: iTunes ── */}
      {tab === "itunes" && !album && !artist && (
        <div>
          <p style={{ color: "#888", fontSize: "0.9em", marginBottom: 15 }}>Búsqueda con iTunes — portadas hasta 600px:</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && searchITunes()} placeholder="Buscar en iTunes..." style={{ ...IS, flex: 1, minWidth: 200 }} />
            <button onClick={searchITunes} disabled={loading} style={{ ...BS, background: "#ef4444" }}>{loading ? "⏳" : "🍎 Buscar iTunes"}</button>
          </div>
          {loading && <Spinner />}
          {error && <ErrorMsg error={error} />}
          {!loading && results && results.source === "itunes" && (
            <div>
              {albums.length > 0 ? (
                <div><h3 style={{ color: "#ef4444", marginBottom: 12 }}>💿 Álbumes (iTunes)</h3>
                <AlbumGrid albums={albums} source="itunes" onSelect={(id) => loadAlbum(id, "itunes")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} /></div>
              ) : <p style={{ textAlign: "center", color: "#555", padding: 40 }}>No se encontraron resultados</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Album Detail ── */}
      {album && !loading && (
        <div>
          <button onClick={() => setAlbum(null)} style={{ ...SM, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 25, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <img src={album.cover_xl || album.cover_big || album.cover_medium} style={{ width: 250, height: 250, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} />
              {/* Fav + Playlist buttons on image */}
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", gap: 4 }}>
                <button onClick={e => handleFavorite(e, "album", album.id, album.name, album.artist, album.cover_xl || album.cover_big, album.source)} style={{ background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", fontSize: "1em" }}>
                  {isFavorite("album", album.id) ? "❤️" : "🤍"}
                </button>
                <button onClick={e => handleAddToPlaylist(e, "album", album.id, album.name, album.artist, album.cover_xl || album.cover_big, album.source)} style={{ background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", fontSize: "1em" }}>➕</button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{album.name}</h2>
              {album.artist_id && album.source === "deezer" ? (
                <p style={{ color: "#1ed760", marginBottom: 5, cursor: "pointer" }} onClick={() => { setAlbum(null); loadArtist(album.artist_id); }}>{album.artist}</p>
              ) : <p style={{ color: "#1ed760", marginBottom: 5 }}>{album.artist}</p>}
              <p style={{ color: "#888", marginBottom: 3 }}>{album.release_date || album.year} {album.total_tracks ? `— ${album.total_tracks} canciones` : ""} {album.track_count ? `— ${album.track_count} canciones` : ""}</p>
              {album.label && <p style={{ color: "#555", fontSize: "0.85em" }}>Sello: {album.label}</p>}
              {album.genres?.length > 0 && <p style={{ color: "#555", fontSize: "0.85em" }}>Géneros: {album.genres.join(", ")}</p>}
              {album.genre && <p style={{ color: "#555", fontSize: "0.85em" }}>Género: {album.genre}</p>}
              {album.images?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#888", fontSize: "0.8em", marginBottom: 6 }}>⬇️ Descargar portada:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {album.images.map((img, i) => (
                      <button key={i} onClick={() => downloadImage(img.url, album.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")} style={{ ...SM, background: i === 0 ? "#22c55e" : "#3b82f6" }}>⬇️ {img.label || img.size}</button>
                    ))}
                  </div>
                </div>
              )}
              {(album.cover_xl || album.cover_big) && !album.images?.length && (
                <button onClick={() => downloadImage(album.cover_xl || album.cover_big, album.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_cover.jpg")} style={{ ...SM, background: "#22c55e", marginTop: 12 }}>⬇️ Descargar portada</button>
              )}
            </div>
          </div>
          {album.source === "deezer" && album.id && (
            <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
              <iframe src={"https://www.deezer.com/widgets/album?id=" + album.id + "&layout=dark&tracklist=true"} width="100%" height="380" frameBorder="0" allowTransparency="true" style={{ borderRadius: 12 }} />
            </div>
          )}
          {album.tracks?.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 10 }}>🎶 Canciones</h3>
              <div style={{ background: "#1a1a2e", borderRadius: 12, border: "1px solid #2a2a3e", overflow: "hidden" }}>
                {album.tracks.map((track, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderBottom: "1px solid #2a2a3e" }}>
                    <span style={{ color: "#555", width: 25, textAlign: "right", fontSize: "0.85em" }}>{track.number || i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#e0e0e0", fontSize: "0.95em" }}>{track.name}</div>
                      {track.artist && track.artist !== album.artist && <div style={{ color: "#666", fontSize: "0.8em" }}>{track.artist}</div>}
                    </div>
                    {track.duration && <span style={{ color: "#555", fontSize: "0.85em" }}>{track.duration}</span>}
                    {/* Fav & playlist per track */}
                    <button onClick={e => handleFavorite(e, "track", String(track.id || i), track.name, track.artist || album.artist, "", album.source)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85em" }}>
                      {isFavorite("track", String(track.id || i)) ? "❤️" : "🤍"}
                    </button>
                    {track.preview_url && (
                      <button onClick={() => { const audio = document.getElementById("preview-" + i); if (audio.paused) audio.play(); else { audio.pause(); audio.currentTime = 0; } }} style={{ ...SM, background: "#3b82f6", padding: "4px 10px", fontSize: "0.75em" }}>
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

      {/* ── Artist Detail ── */}
      {artist && !loading && (
        <div>
          <button onClick={() => setArtist(null)} style={{ ...SM, background: "#555", marginBottom: 15 }}>← Volver</button>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 25, marginBottom: 20, border: "1px solid #2a2a3e", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              {artist.picture_xl ? <img src={artist.picture_xl} style={{ width: 180, height: 180, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }} /> : <div style={{ width: 180, height: 180, borderRadius: "50%", background: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "4em" }}>🎤</div>}
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", gap: 4 }}>
                <button onClick={e => handleFavorite(e, "artist", artist.id, artist.name, "", artist.picture_xl, "deezer")} style={{ background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", fontSize: "1em" }}>
                  {isFavorite("artist", artist.id) ? "❤️" : "🤍"}
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 style={{ fontSize: "1.5em", marginBottom: 5 }}>{artist.name}</h2>
              {artist.nb_fans > 0 && <p style={{ color: "#888", marginBottom: 8 }}>{artist.nb_fans.toLocaleString()} fans</p>}
              {artist.images?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {artist.images.map((img, i) => (
                    <button key={i} onClick={() => downloadImage(img.url, artist.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") + "_" + (img.label || img.size) + ".jpg")} style={{ ...SM, background: i === 0 ? "#22c55e" : "#3b82f6" }}>⬇️ {img.label || img.size}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {artist.albums?.length > 0 && (
            <div>
              <h3 style={{ color: "#1ed760", marginBottom: 12 }}>💿 Álbumes ({artist.nb_album || artist.albums.length})</h3>
              <AlbumGrid albums={artist.albums} source="deezer" onSelect={(id) => loadAlbum(id, "deezer")} onFavorite={handleFavorite} onPlaylist={handleAddToPlaylist} isFavorite={isFavorite} />
            </div>
          )}
        </div>
      )}
    </div>
  );

  function searchITunes() {
    if (!query.trim()) return;
    setLoading(true); setError(""); setResults(null);
    fetch("/api/music?action=search&q=" + encodeURIComponent(query) + "&source=itunes&entity=album&limit=20")
      .then(r => r.json()).then(data => { if (data.error) setError(data.error); else setResults(data); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }
}

// ── Shared components ──

function AlbumGrid({ albums, source, onSelect, onFavorite, onPlaylist, isFavorite }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10 }}>
      {albums.map(a => (
        <div key={a.id} onClick={() => onSelect(a.id)} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #2a2a3e", position: "relative", transition: "transform 0.15s" }}
          onMouseOver={e => e.currentTarget.style.transform = "scale(1.03)"} onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
        >
          <img src={a.cover_big || a.cover_xl || a.cover_medium} style={{ width: "100%", aspectRatio: 1, objectFit: "cover", display: "block" }} loading="lazy" />
          {/* Fav & Playlist overlay */}
          <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 3 }}>
            <button onClick={e => onFavorite(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} style={{ background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: "0.8em", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isFavorite("album", a.id) ? "❤️" : "🤍"}
            </button>
            <button onClick={e => onPlaylist(e, "album", a.id, a.name, a.artist, a.cover_big || a.cover_xl, a.source || source)} style={{ background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: "0.75em", display: "flex", alignItems: "center", justifyContent: "center" }}>➕</button>
          </div>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ color: "#ccc", fontSize: "0.8em", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
            <div style={{ color: "#666", fontSize: "0.7em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ source }) {
  return <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: "0.75em", marginBottom: 15, background: source === "deezer" ? "#1a2e1a" : "#2e1a1a", color: source === "deezer" ? "#22c55e" : "#ef4444", border: `1px solid ${source === "deezer" ? "#2a4a2a" : "#4a2a2a"}` }}>Fuente: {source === "deezer" ? "🟢 Deezer (1400px)" : "🍎 iTunes (600px)"}</div>;
}

function ErrorMsg({ error }) {
  return <div style={{ background: "#2e1a1a", border: "1px solid #5a2a2a", borderRadius: 10, padding: 15, marginBottom: 15 }}><div style={{ color: "#ef4444", fontWeight: 600, marginBottom: 5 }}>❌ Error</div><div style={{ color: "#ccc", fontSize: "0.9em" }}>{error}</div></div>;
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 40, color: "#1ed760", fontSize: "1.1em" }}>⏳ Cargando...</div>;
}
