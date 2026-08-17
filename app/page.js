"use client";
import { useState } from "react";

/* ═══════════════════════════════════════════════════
   PÁGINA ESPEJO — Versión mejorada
   ═══════════════════════════════════════════════════ */

const FILE_ICONS = {
  jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️", bmp: "🖼️",
  pdf: "📄", zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦",
  mp4: "🎬", mp3: "🎵", wav: "🎵", avi: "🎬", mkv: "🎬", webm: "🎬",
  doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", ppt: "📊", pptx: "📊",
  exe: "⚙️", dmg: "⚙️", iso: "💿", txt: "📃", csv: "📊", json: "📃",
  css: "🎨", js: "⚡", py: "🐍", html: "🌐", epub: "📖", mobi: "📖",
  flac: "🎵", ogg: "🎵", wma: "🎵", apk: "📱",
};

function getIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "📎";
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function MirrorPage() {
  const [url, setUrl] = useState("");
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState({});
  const [downloadingAll, setDownloadingAll] = useState(false);

  async function mirrorPage() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setResources([]);
    setPageTitle("");
    setDownloadStatus({});

    try {
      const res = await fetch("/api/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else if (data.resources.length === 0) {
        setError("No se encontraron imágenes ni archivos en esta página. Puede ser que el sitio carga su contenido con JavaScript (no lo podemos ver desde el servidor).");
      } else {
        setResources(data.resources);
        setSourceUrl(data.source_url);
        setPageTitle(data.title || "");
      }
    } catch (e) {
      setError("Error de conexión: " + e.message);
    }

    setLoading(false);
  }

  async function downloadOne(resourceUrl, filename) {
    setDownloadStatus((s) => ({ ...s, [resourceUrl]: "downloading" }));
    try {
      const res = await fetch(
        `/api/download?url=${encodeURIComponent(resourceUrl)}&filename=${encodeURIComponent(filename)}`
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      setDownloadStatus((s) => ({ ...s, [resourceUrl]: "done" }));
    } catch (e) {
      setDownloadStatus((s) => ({ ...s, [resourceUrl]: "error" }));
    }
  }

  async function downloadAll() {
    setDownloadingAll(true);
    const pending = resources.filter(
      (r) => !downloadStatus[r.url] || downloadStatus[r.url] === "error"
    );
    for (let i = 0; i < pending.length; i++) {
      setDownloadStatus((s) => ({ ...s, [pending[i].url]: "downloading" }));
      try {
        const res = await fetch(
          `/api/download?url=${encodeURIComponent(pending[i].url)}&filename=${encodeURIComponent(pending[i].filename)}`
        );
        if (res.ok) {
          const blob = await res.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = pending[i].filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
          setDownloadStatus((s) => ({ ...s, [pending[i].url]: "done" }));
        } else {
          setDownloadStatus((s) => ({ ...s, [pending[i].url]: "error" }));
        }
      } catch {
        setDownloadStatus((s) => ({ ...s, [pending[i].url]: "error" }));
      }
      if (i < pending.length - 1) await new Promise((ok) => setTimeout(ok, 800));
    }
    setDownloadingAll(false);
  }

  const images = resources.filter((r) => r.type === "image").length;
  const files = resources.filter((r) => r.type === "file").length;
  const doneCount = Object.values(downloadStatus).filter((s) => s === "done").length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 20px" }}>
      <nav style={{ marginBottom: 20, display: "flex", gap: 15 }}>
        <a href="/downloads">⬇️ Descargas manuales</a>
      </nav>

      <h1 style={{ fontSize: "2em", marginBottom: 8 }}>
        🪞 Espejo + <span style={{ color: "#7c5cfc" }}>Descargas</span>
      </h1>
      <p style={{ color: "#888", marginBottom: 25, lineHeight: 1.5 }}>
        Pega la URL de cualquier página → ve todas sus imágenes y archivos → descárgalos con un click.
      </p>

      {/* Input */}
      <div style={{ display: "flex", gap: 10, marginBottom: 25 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && mirrorPage()}
          placeholder="https://ejemplo.com  — pega cualquier URL aquí"
          disabled={loading}
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "#1a1a2e",
            color: "#fff",
            fontSize: "1em",
            outline: "none",
          }}
        />
        <button
          onClick={mirrorPage}
          disabled={loading}
          style={{
            padding: "14px 24px",
            borderRadius: 10,
            border: "none",
            background: loading ? "#555" : "#7c5cfc",
            color: "#fff",
            fontSize: "1em",
            cursor: loading ? "wait" : "pointer",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "⏳ Buscando..." : "🪞 Espejar"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#7c5cfc" }}>
          <div style={{ fontSize: "2em", marginBottom: 10 }}>🪞</div>
          <div>Analizando la página... Esto puede tardar unos segundos.</div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div
          style={{
            background: "#2a1a1a",
            border: "1px solid #5a2a2a",
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
            color: "#ef4444",
          }}
        >
          <div style={{ fontSize: "1.2em", marginBottom: 8 }}>❌ Error</div>
          <div style={{ color: "#ccc", lineHeight: 1.5 }}>{error}</div>
          <div style={{ color: "#888", fontSize: "0.85em", marginTop: 10 }}>
            💡 Tips: Prueba con otra página. Algunos sitios bloquean peticiones de servidores (como Instagram, Twitter, etc.).
            Sitios que suelen funcionar: blogs, wikis, sitios de imágenes, foros.
          </div>
        </div>
      )}

      {/* Stats + Download all */}
      {resources.length > 0 && !loading && (
        <>
          {pageTitle && (
            <div style={{ color: "#aaa", marginBottom: 10, fontSize: "0.9em" }}>
              📌 <strong>{pageTitle}</strong>
            </div>
          )}
          <div style={{ color: "#555", fontSize: "0.8em", marginBottom: 15, wordBreak: "break-all" }}>
            🔗 {sourceUrl}
          </div>

          <div style={{ display: "flex", gap: 15, marginBottom: 20, flexWrap: "wrap" }}>
            <StatBox num={resources.length} label="Total" color="#7c5cfc" />
            <StatBox num={images} label="🖼️ Imágenes" color="#22c55e" />
            <StatBox num={files} label="📎 Archivos" color="#3b82f6" />
            <StatBox num={doneCount} label="✅ Descargados" color="#16a34a" />
          </div>

          <button
            onClick={downloadAll}
            disabled={downloadingAll}
            style={{
              padding: "14px 24px",
              borderRadius: 10,
              border: "none",
              background: downloadingAll ? "#555" : "#22c55e",
              color: "#fff",
              fontSize: "1em",
              cursor: downloadingAll ? "wait" : "pointer",
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            {downloadingAll
              ? `⬇️ Descargando... (${doneCount}/${resources.length})`
              : `⬇️ Descargar todo (${resources.length})`}
          </button>
        </>
      )}

      {/* Grid de recursos */}
      {!loading && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
            gap: 15,
          }}
        >
          {resources.map((r) => (
            <ResourceCard
              key={r.url}
              resource={r}
              status={downloadStatus[r.url]}
              onDownload={() => downloadOne(r.url, r.filename)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({ num, label, color }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a3e",
        borderRadius: 10,
        padding: "10px 16px",
        flex: 1,
        minWidth: 100,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5em", fontWeight: 700, color }}>{num}</div>
      <div style={{ fontSize: "0.75em", color: "#888" }}>{label}</div>
    </div>
  );
}

function ResourceCard({ resource, status, onDownload }) {
  const isImage = resource.type === "image";
  const icon = getIcon(resource.filename);
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(resource.url)}`;

  let btnBg = "#22c55e";
  let btnText = "⬇️ Descargar";
  let btnDisabled = false;
  if (status === "downloading") {
    btnBg = "#3b82f6";
    btnText = "⬇️ Descargando...";
    btnDisabled = true;
  } else if (status === "done") {
    btnBg = "#16a34a";
    btnText = "✅ ¡Listo!";
    btnDisabled = true;
  } else if (status === "error") {
    btnBg = "#ef4444";
    btnText = "❌ Reintentar";
  }

  return (
    <div
      style={{
        background: "#1a1a2e",
        borderRadius: 12,
        border: "1px solid #2a2a3e",
        overflow: "hidden",
      }}
    >
      {/* Thumbnail o ícono */}
      {isImage ? (
        <>
          <img
            src={proxyUrl}
            alt={resource.filename}
            loading="lazy"
            style={{
              width: "100%",
              height: 180,
              objectFit: "cover",
              background: "#0a0a1a",
              display: "block",
            }}
            onError={(e) => {
              e.target.style.display = "none";
              if (e.target.nextSibling) e.target.nextSibling.style.display = "flex";
            }}
          />
          <div
            style={{
              width: "100%",
              height: 180,
              background: "linear-gradient(135deg,#1a1a2e,#2a2a3e)",
              display: "none",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "3em",
            }}
          >
            {icon}
          </div>
        </>
      ) : (
        <div
          style={{
            width: "100%",
            height: 180,
            background: "linear-gradient(135deg,#1a1a2e,#2a2a3e)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "3em",
          }}
        >
          {icon}
        </div>
      )}

      {/* Info */}
      <div style={{ padding: "12px 14px" }}>
        <div
          style={{
            color: "#ccc",
            fontSize: "0.85em",
            wordBreak: "break-all",
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          {resource.filename}
        </div>
        <div style={{ color: "#555", fontSize: "0.7em", wordBreak: "break-all", marginBottom: 10 }}>
          {resource.url.length > 70 ? resource.url.substring(0, 70) + "..." : resource.url}
        </div>
        <button
          onClick={onDownload}
          disabled={btnDisabled}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "none",
            background: btnBg,
            color: "#fff",
            fontSize: "0.9em",
            cursor: btnDisabled ? "default" : "pointer",
            fontWeight: 600,
            transition: "background 0.2s",
          }}
        >
          {btnText}
        </button>
      </div>
    </div>
  );
}
