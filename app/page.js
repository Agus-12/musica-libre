"use client";
import { useState, useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════
   PÁGINA ESPEJO: Pegas URL → ves recursos → descargas
   ═══════════════════════════════════════════════════ */

const FILE_ICONS = {
  jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️", bmp: "🖼️",
  pdf: "📄", zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦",
  mp4: "🎬", mp3: "🎵", wav: "🎵", avi: "🎬", mkv: "🎬",
  doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", ppt: "📊", pptx: "📊",
  exe: "⚙️", dmg: "⚙️", iso: "💿", txt: "📃", csv: "📊", json: "📃",
  css: "🎨", js: "⚡", py: "🐍", html: "🌐",
};

function getIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "📎";
}

export default function MirrorPage() {
  const [url, setUrl] = useState("");
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState({}); // url -> status
  const [sourceUrl, setSourceUrl] = useState("");

  // Espejar la página
  async function mirrorPage() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setResources([]);
    try {
      const res = await fetch("/api/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResources(data.resources);
        setSourceUrl(data.source_url);
      }
    } catch (e) {
      setError("Error de conexión: " + e.message);
    }
    setLoading(false);
  }

  // Descargar un archivo
  async function downloadOne(resourceUrl, filename) {
    setDownloadStatus((s) => ({ ...s, [resourceUrl]: "downloading" }));
    try {
      const res = await fetch(
        `/api/download?url=${encodeURIComponent(resourceUrl)}&filename=${encodeURIComponent(filename)}`
      );
      if (!res.ok) throw new Error("Error del servidor");
      const blob = await res.blob();
      // Crear descarga en el navegador
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setDownloadStatus((s) => ({ ...s, [resourceUrl]: "done" }));
    } catch (e) {
      setDownloadStatus((s) => ({ ...s, [resourceUrl]: "error" }));
    }
  }

  // Descargar todo
  async function downloadAll() {
    for (const r of resources) {
      if (downloadStatus[r.url] !== "done") {
        await downloadOne(r.url, r.filename);
        // Pequeña pausa entre descargas
        await new Promise((ok) => setTimeout(ok, 500));
      }
    }
  }

  const images = resources.filter((r) => r.type === "image").length;
  const files = resources.filter((r) => r.type === "file").length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 20px" }}>
      {/* Navegación */}
      <nav style={{ marginBottom: 20, display: "flex", gap: 15 }}>
        <a href="/downloads">⬇️ Descargas</a>
      </nav>

      <h1 style={{ fontSize: "2em", marginBottom: 8 }}>
        🪞 Espejo + <span style={{ color: "#7c5cfc" }}>Descargas</span>
      </h1>
      <p style={{ color: "#888", marginBottom: 25 }}>
        Pega la URL de cualquier página → se espejea con botones de descarga en cada imagen/archivo.
      </p>

      {/* Input */}
      <div style={{ display: "flex", gap: 10, marginBottom: 25 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mirrorPage()}
          placeholder="https://ejemplo.com/pagina-con-imagenes"
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "#1a1a2e",
            color: "#fff",
            fontSize: "1em",
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
          {loading ? "⏳ Espera..." : "🪞 Espejar"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ textAlign: "center", padding: 20, color: "#ef4444", marginBottom: 20 }}>
          ❌ {error}
        </div>
      )}

      {/* Estadísticas */}
      {resources.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 15, marginBottom: 20, flexWrap: "wrap" }}>
            <StatBox num={resources.length} label="Total recursos" />
            <StatBox num={images} label="🖼️ Imágenes" />
            <StatBox num={files} label="📎 Archivos" />
          </div>
          <button
            onClick={downloadAll}
            style={{
              padding: "14px 24px",
              borderRadius: 10,
              border: "none",
              background: "#22c55e",
              color: "#fff",
              fontSize: "1em",
              cursor: "pointer",
              fontWeight: 600,
              marginBottom: 20,
            }}
          >
            ⬇️ Descargar todo ({resources.length})
          </button>
          <p style={{ color: "#555", fontSize: "0.85em", marginBottom: 15 }}>
            📌 Fuente: {sourceUrl}
          </p>
        </>
      )}

      {/* Grid de recursos */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
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
    </div>
  );
}

/* ── Componentes auxiliares ── */

function StatBox({ num, label }) {
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a3e",
        borderRadius: 10,
        padding: "10px 16px",
        flex: 1,
        minWidth: 120,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5em", fontWeight: 700, color: "#7c5cfc" }}>{num}</div>
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
  if (status === "downloading") {
    btnBg = "#3b82f6";
    btnText = "⬇️ Descargando...";
  } else if (status === "done") {
    btnBg = "#16a34a";
    btnText = "✅ Listo";
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
        transition: "transform 0.2s",
      }}
    >
      {/* Thumbnail */}
      {isImage ? (
        <img
          src={proxyUrl}
          alt={resource.filename}
          style={{
            width: "100%",
            height: 180,
            objectFit: "cover",
            background: "#0a0a1a",
            display: "block",
          }}
          onError={(e) => {
            e.target.style.display = "none";
            e.target.nextSibling.style.display = "flex";
          }}
        />
      ) : null}
      <div
        style={{
          width: "100%",
          height: isImage ? 0 : 180,
          background: "linear-gradient(135deg,#1a1a2e,#2a2a3e)",
          display: isImage ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "3em",
        }}
      >
        {icon}
      </div>

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
        <div style={{ color: "#666", fontSize: "0.7em", wordBreak: "break-all", marginBottom: 10 }}>
          {resource.url.substring(0, 80)}
          {resource.url.length > 80 ? "..." : ""}
        </div>
        <button
          onClick={status === "done" ? null : onDownload}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "none",
            background: btnBg,
            color: "#fff",
            fontSize: "0.9em",
            cursor: status === "done" ? "default" : "pointer",
            fontWeight: 600,
          }}
        >
          {btnText}
        </button>
      </div>
    </div>
  );
}
