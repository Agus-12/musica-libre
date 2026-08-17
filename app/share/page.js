"use client";
import { useEffect, useState } from "react";

export default function SharePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url") || "";
    const name = params.get("name") || "";
    const artist = params.get("artist") || "";
    const cover = params.get("cover") || "";
    const source = params.get("source") || "auto";

    // Si ya tenemos datos por parámetros, mostrar directamente
    if (name && cover) {
      setData({ name, artist, cover_url: cover, source });
      setLoading(false);
      return;
    }

    // Si tenemos URL, usar oEmbed o la API de música
    if (url) {
      loadFromUrl(url);
    } else {
      setError("No se encontró información de la canción. Pegá un link de Spotify, Deezer o iTunes.");
      setLoading(false);
    }
  }, []);

  async function loadFromUrl(url) {
    try {
      // Intentar oEmbed (Spotify)
      if (url.includes("spotify.com")) {
        const res = await fetch("/api/music?action=oembed&url=" + encodeURIComponent(url));
        const d = await res.json();
        if (!d.error) {
          setData({
            name: d.title || "",
            artist: "",
            cover_url: d.thumbnail_large || d.thumbnail || "",
            source: "spotify",
            source_url: url,
          });
          setLoading(false);
          return;
        }
      }

      // Intentar Deezer
      if (url.includes("deezer.com")) {
        const match = url.match(/deezer\.com\/(album|track|artist)\/(\d+)/);
        if (match) {
          const type = match[1];
          const id = match[2];
          if (type === "album") {
            const res = await fetch("/api/music?action=album&id=" + id + "&source=deezer");
            const d = await res.json();
            if (!d.error) {
              setData({
                name: d.name || "",
                artist: d.artist || "",
                cover_url: d.cover_xl || d.cover_big || d.cover_medium || "",
                source: "deezer",
                source_url: url,
                tracks: d.tracks || [],
              });
              setLoading(false);
              return;
            }
          }
        }
      }

      // Intentar iTunes / Apple Music
      if (url.includes("apple.com") || url.includes("itunes")) {
        const match = url.match(/\/(\d+)\?/);
        const match2 = url.match(/\/(\d+)$/);
        const id = (match && match[1]) || (match2 && match2[1]) || "";
        if (id) {
          const res = await fetch("/api/music?action=lookup&id=" + id + "&source=itunes");
          const d = await res.json();
          if (!d.error && d.name) {
            setData({
              name: d.name || "",
              artist: d.artist || "",
              cover_url: d.cover_xl || d.cover_big || d.cover_medium || "",
              source: "itunes",
              source_url: url,
              tracks: d.tracks || [],
            });
            setLoading(false);
            return;
          }
        }
      }

      // Fallback: buscar por URL como texto
      const res = await fetch("/api/music?action=search&q=" + encodeURIComponent(url) + "&type=album&limit=1");
      const d = await res.json();
      if (d.albums && d.albums.length > 0) {
        const a = d.albums[0];
        setData({
          name: a.name || "",
          artist: a.artist || "",
          cover_url: a.cover_xl || a.cover_big || a.cover_medium || "",
          source: a.source || "auto",
        });
        setLoading(false);
        return;
      }

      setError("No se encontró información para ese link");
      setLoading(false);
    } catch (e) {
      setError("Error: " + e.message);
      setLoading(false);
    }
  }

  async function handleDownloadCover() {
    if (!data || !data.cover_url) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/download?url=" + encodeURIComponent(data.cover_url));
      if (!res.ok) throw new Error("Error al descargar");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = (data.name || "cover").replace(/[^a-zA-Z0-9 ]/g, "") + ".jpg";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      window.open(data.cover_url, "_blank");
    }
    setDownloading(false);
  }

  function sourceLabel(src) {
    if (src === "spotify") return "Spotify";
    if (src === "deezer") return "Deezer";
    if (src === "itunes") return "Apple Music";
    return src;
  }

  // ── Styles ──
  const bg = {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #24243e 100%)",
    color: "#fff",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  };

  if (loading) {
    return (
      <div style={bg}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #333", borderTopColor: "#7c5cfc", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }}></div>
          <p style={{ color: "#888" }}>Cargando...</p>
          <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={bg}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="1.5" style={{ margin: "0 auto 16px", display: "block" }}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <h2 style={{ marginBottom: 8 }}>No encontrado</h2>
          <p style={{ color: "#888", marginBottom: 20 }}>{error}</p>
          <a href="/spotify" style={{ color: "#7c5cfc", textDecoration: "underline" }}>← Ir a buscar música</a>
        </div>
      </div>
    );
  }

  return (
    <div style={bg}>
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: "1.4em", fontWeight: 800, background: "linear-gradient(135deg, #7c5cfc, #e040fb)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>🎵 Música Libre</span>
        </div>

        {/* Cover Art */}
        {data.cover_url && (
          <div style={{ position: "relative", display: "inline-block", marginBottom: 20 }}>
            <img
              src={data.cover_url}
              alt={data.name}
              style={{ width: 280, height: 280, borderRadius: 16, objectFit: "cover", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" }}
            />
            {/* Download overlay button */}
            <button
              onClick={handleDownloadCover}
              disabled={downloading}
              style={{ position: "absolute", bottom: 10, right: 10, background: downloading ? "#555" : "#7c5cfc", border: "none", borderRadius: "50%", width: 44, height: 44, cursor: downloading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 15px rgba(124,92,252,0.4)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
            </button>
          </div>
        )}

        {/* Fallback if no cover */}
        {!data.cover_url && (
          <div style={{ width: 280, height: 280, borderRadius: 16, background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="#333"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.67 13 5 14.67 5 17s2.67 4 5 4 5-1.67 5-4V7h4V3h-7z"/></svg>
          </div>
        )}

        {/* Song Info */}
        <h1 style={{ fontSize: "1.4em", marginBottom: 4, fontWeight: 700 }}>{data.name}</h1>
        {data.artist && <p style={{ color: "#aaa", fontSize: "1em", marginBottom: 8 }}>{data.artist}</p>}
        {data.source && <p style={{ color: "#666", fontSize: "0.8em", textTransform: "uppercase", letterSpacing: 1, marginBottom: 20 }}>Fuente: {sourceLabel(data.source)}</p>}

        {/* Action Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 300, margin: "0 auto" }}>
          {/* Download Cover Button */}
          <button
            onClick={handleDownloadCover}
            disabled={downloading}
            style={{ padding: "14px 20px", borderRadius: 12, border: "none", background: downloading ? "#555" : "linear-gradient(135deg, #7c5cfc, #e040fb)", color: "#fff", fontSize: "1em", fontWeight: 700, cursor: downloading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 20px rgba(124,92,252,0.3)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/></svg>
            {downloading ? "Descargando..." : "Descargar portada"}
          </button>

          {/* Open in source platform */}
          {data.source_url && (
            <a
              href={data.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: "14px 20px", borderRadius: 12, border: "1px solid #444", background: "transparent", color: "#7c5cfc", fontSize: "0.95em", fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c5cfc" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
              Abrir en {sourceLabel(data.source)}
            </a>
          )}

          {/* Go to app */}
          <a
            href="/spotify"
            style={{ color: "#666", fontSize: "0.85em", textDecoration: "underline", marginTop: 8 }}
          >
            Explorar más música en Música Libre →
          </a>
        </div>

        {/* Tracks list if available */}
        {data.tracks && data.tracks.length > 0 && (
          <div style={{ marginTop: 24, textAlign: "left" }}>
            <h3 style={{ color: "#888", fontSize: "0.85em", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Canciones ({data.tracks.length})</h3>
            {data.tracks.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1a1a2e" }}>
                <span style={{ color: "#555", fontSize: "0.8em", width: 20, textAlign: "right" }}>{t.number || i + 1}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ color: "#ccc", fontSize: "0.9em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  {t.artist && <div style={{ color: "#666", fontSize: "0.75em" }}>{t.artist}</div>}
                </div>
                {t.duration && <span style={{ color: "#555", fontSize: "0.8em" }}>{t.duration}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
