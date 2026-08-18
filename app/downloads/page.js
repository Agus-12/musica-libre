"use client";
import { useState, useEffect } from "react";

/* ═══════════════════════════════════════════════════
   PÁGINA DESCARGAS: Agregar links manualmente
   ═══════════════════════════════════════════════════ */

export default function DownloadsPage() {
  const [url, setUrl] = useState("");
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Cargar desde localStorage
    const saved = localStorage.getItem("download_links");
    if (saved) setLinks(JSON.parse(saved));
  }, []);

  function saveLinks(newLinks) {
    setLinks(newLinks);
    localStorage.setItem("download_links", JSON.stringify(newLinks));
  }

  async function addLink() {
    if (!url.trim()) return;
    const newLink = {
      id: Date.now().toString(36),
      url: url.trim(),
      status: "pending",
      addedAt: new Date().toISOString(),
      filename: url.trim().split("/").pop().split("?")[0] || "archivo",
    };
    saveLinks([newLink, ...links]);
    setUrl("");
  }

  function removeLink(id) {
    saveLinks(links.filter((l) => l.id !== id));
  }

  // Descargar un link
  async function downloadLink(link) {
    updateStatus(link.id, "downloading");
    try {
      const res = await fetch(
        `/api/download?url=${encodeURIComponent(link.url)}&filename=${encodeURIComponent(link.filename)}`
      );
      if (!res.ok) throw new Error("Error");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = link.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      updateStatus(link.id, "done");
    } catch (e) {
      updateStatus(link.id, "error");
    }
  }

  // Descargar todo pendiente
  async function downloadAll() {
    for (const link of links.filter((l) => l.status === "pending" || l.status === "error")) {
      await downloadLink(link);
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }

  function updateStatus(id, status) {
    saveLinks(links.map((l) => (l.id === id ? { ...l, status } : l)));
  }

  const pending = links.filter((l) => l.status === "pending").length;
  const done = links.filter((l) => l.status === "done").length;
  const errorCount = links.filter((l) => l.status === "error").length;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "30px 20px" }}>
      <nav style={{ marginBottom: 30, display: "flex", gap: 15 }}>
        <a href="/">🪞 Espejo</a>
      </nav>

      <h1 style={{ fontSize: "2em", marginBottom: 8 }}>
        ⬇️ Descargas <span style={{ color: "#22c55e" }}>Manuales</span>
      </h1>
      <p style={{ color: "var(--text3)", marginBottom: 25 }}>
        Agrega enlaces uno por uno y descárgalos.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addLink()}
          placeholder="https://ejemplo.com/archivo.zip"
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text-strong)",
            fontSize: "1em",
          }}
        />
        <button
          onClick={addLink}
          style={{
            padding: "14px 24px",
            borderRadius: 10,
            border: "none",
            background: "#22c55e",
            color: "var(--text-strong)",
            fontSize: "1em",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Agregar
        </button>
      </div>

      {links.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 15, marginBottom: 20, flexWrap: "wrap" }}>
            <Stat num={pending} label="⏳ Pendientes" color="#fbbf24" />
            <Stat num={done} label="✅ Listo" color="#22c55e" />
            <Stat num={errorCount} label="❌ Error" color="#ef4444" />
          </div>
          {pending > 0 && (
            <button
              onClick={downloadAll}
              style={{
                padding: "12px 20px",
                borderRadius: 10,
                border: "none",
                background: "#22c55e",
                color: "var(--text-strong)",
                cursor: "pointer",
                fontWeight: 600,
                marginBottom: 20,
              }}
            >
              ⬇️ Descargar todo pendiente ({pending})
            </button>
          )}
        </>
      )}

      {links.map((link) => (
        <div
          key={link.id}
          style={{
            background: "#1a2e1a",
            borderRadius: 10,
            padding: 16,
            marginBottom: 10,
            border: "1px solid #2a3e2a",
          }}
        >
          <button
            onClick={() => removeLink(link.id)}
            style={{
              float: "right",
              background: "#ef4444",
              padding: "4px 12px",
              borderRadius: 6,
              border: "none",
              color: "var(--text-strong)",
              cursor: "pointer",
              fontSize: "0.8em",
            }}
          >
            ✕
          </button>
          <div style={{ color: "#22c55e", wordBreak: "break-all", fontSize: "0.95em" }}>
            {link.url}
          </div>
          <div style={{ color: "var(--text4)", fontSize: "0.8em", marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span
              style={{
                padding: "2px 10px",
                borderRadius: 20,
                fontSize: "0.75em",
                fontWeight: 600,
                background:
                  link.status === "pending"
                    ? "#fbbf24"
                    : link.status === "downloading"
                    ? "#3b82f6"
                    : link.status === "done"
                    ? "#22c55e"
                    : "#ef4444",
                color: link.status === "pending" ? "#000" : "#fff",
              }}
            >
              {link.status === "pending"
                ? "⏳ Pendiente"
                : link.status === "downloading"
                ? "⬇️ Descargando..."
                : link.status === "done"
                ? "✅ Descargado"
                : "❌ Error"}
            </span>
            <span>📁 {link.filename}</span>
          </div>
          {link.status !== "downloading" && link.status !== "done" && (
            <button
              onClick={() => downloadLink(link)}
              style={{
                marginTop: 8,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#22c55e",
                color: "var(--text-strong)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85em",
              }}
            >
              ⬇️ Descargar ahora
            </button>
          )}
        </div>
      ))}

      {links.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--text5)", padding: 40 }}>
          No hay enlaces. Agrega uno arriba 👆 o usa el <a href="/">🪞 Espejo</a>
        </p>
      )}
    </div>
  );
}

function Stat({ num, label, color }) {
  return (
    <div
      style={{
        background: "#1a2e1a",
        border: "1px solid #2a3e2a",
        borderRadius: 10,
        padding: "10px 16px",
        flex: 1,
        minWidth: 120,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5em", fontWeight: 700, color }}>{num}</div>
      <div style={{ fontSize: "0.75em", color: "var(--text3)" }}>{label}</div>
    </div>
  );
}
