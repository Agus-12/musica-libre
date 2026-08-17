"use client";
import { useState } from "react";

/* ═══════════════════════════════════════════════════
   PÁGINA PRINCIPAL — Espejo completo
   
   Pegas una URL → te abre la página COMPLETA dentro del espejo
   con barra flotante para descargar cualquier cosa
   ═══════════════════════════════════════════════════ */

const EXAMPLE_SITES = [
  { name: "W3Schools (imágenes)", url: "https://www.w3schools.com/html/html_images.asp" },
  { name: "Wikipedia", url: "https://www.wikipedia.org" },
  { name: "Hacker News", url: "https://news.ycombinator.com" },
  { name: "Python Docs", url: "https://docs.python.org/3/" },
  { name: "MDN Web Docs", url: "https://developer.mozilla.org/es/" },
];

export default function MirrorPage() {
  const [url, setUrl] = useState("");
  const [browsing, setBrowsing] = useState(false);

  function goMirror(inputUrl) {
    const target = inputUrl || url;
    if (!target.trim()) return;
    setBrowsing(true);
    // Abrir el proxy completo en la misma ventana
    window.location.href = `/api/browse?url=${encodeURIComponent(target.trim())}`;
  }

  function openInIframe() {
    if (!url.trim()) return;
    setBrowsing(true);
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "30px 20px" }}>
      <h1 style={{ fontSize: "2.2em", marginBottom: 8 }}>
        🪞 Espejo <span style={{ color: "#7c5cfc" }}>Completo</span>
      </h1>
      <p style={{ color: "#888", marginBottom: 30, lineHeight: 1.6 }}>
        Pega la URL de cualquier página → se carga <strong>completa</strong> dentro del espejo.<br/>
        Podés <strong>navegar</strong> dentro del espejo y <strong>descargar cualquier archivo</strong> con un click.
      </p>

      {/* AURA Link */}
      <a href="/spotify" style={{ display: "block", background: "linear-gradient(135deg,#1a1a2e,#0a2a1a)", border: "2px solid #1ed760", borderRadius: 12, padding: "16px 20px", marginBottom: 12, textDecoration: "none", color: "#e0e0e0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "2em" }}>🎵</span>
          <div>
            <div style={{ color: "#e8e8ef", fontWeight: 700, fontSize: "1.1em", letterSpacing: 2 }}>AURA</div>
            <div style={{ color: "#888", fontSize: "0.85em" }}>Busca álbumes, descarga canciones y escucha sin conexión</div>
          </div>
          <span style={{ marginLeft: "auto", color: "#1ed760", fontSize: "1.5em" }}>→</span>
        </div>
      </a>

      {/* Profile Link */}
      <a href="/profile" style={{ display: "block", background: "linear-gradient(135deg,#1a1a2e,#1a1a3e)", border: "2px solid #7c5cfc", borderRadius: 12, padding: "16px 20px", marginBottom: 25, textDecoration: "none", color: "#e0e0e0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "2em" }}>👤</span>
          <div>
            <div style={{ color: "#7c5cfc", fontWeight: 700, fontSize: "1.1em" }}>Mi Perfil</div>
            <div style={{ color: "#888", fontSize: "0.85em" }}>Favoritos, playlists y configuración de tu cuenta</div>
          </div>
          <span style={{ marginLeft: "auto", color: "#7c5cfc", fontSize: "1.5em" }}>→</span>
        </div>
      </a>

      {/* Input principal */}
      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && goMirror()}
          placeholder="https://ejemplo.com — pega cualquier URL aquí"
          style={{
            flex: 1,
            padding: "16px 18px",
            borderRadius: 12,
            border: "1px solid #333",
            background: "#1a1a2e",
            color: "#fff",
            fontSize: "1.1em",
            outline: "none",
          }}
        />
        <button
          onClick={() => goMirror()}
          style={{
            padding: "16px 28px",
            borderRadius: 12,
            border: "none",
            background: "#7c5cfc",
            color: "#fff",
            fontSize: "1.1em",
            cursor: "pointer",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          🪞 Espejar
        </button>
      </div>

      {/* Iframe para ver dentro de la misma página */}
      {browsing && url.trim() && (
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#7c5cfc", fontSize: "0.9em", fontWeight: 600 }}>
              🪞 Viendo: {url}
            </span>
            <a
              href="/"
              style={{ color: "#888", fontSize: "0.85em" }}
              onClick={(e) => { e.preventDefault(); setBrowsing(false); }}
            >
              ← Cerrar espejo
            </a>
          </div>
          <iframe
            src={`/api/browse?url=${encodeURIComponent(url.trim())}`}
            style={{
              width: "100%",
              height: "70vh",
              border: "2px solid #2a2a3e",
              borderRadius: 12,
              background: "#fff",
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}

      {/* Cómo funciona */}
      <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 25, marginBottom: 30, border: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "1.3em", marginBottom: 15, color: "#7c5cfc" }}>🧠 ¿Cómo funciona?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 15 }}>
          <Step num="1" text="Pegás la URL de la página que querés espejar" icon="🔗" />
          <Step num="2" text="Nuestro servidor carga la página completa" icon="🪞" />
          <Step num="3" text="Todos los links se reescriben para navegar dentro del espejo" icon="🔄" />
          <Step num="4" text="Una barra flotante te deja descargar cualquier cosa" icon="⬇️" />
        </div>
      </div>

      {/* Barra flotante preview */}
      <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 25, marginBottom: 30, border: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "1.3em", marginBottom: 15, color: "#22c55e" }}>🛠️ Barra flotante que aparece</h2>
        <div
          style={{
            background: "linear-gradient(135deg,#1a1a2e,#2a1a3e)",
            border: "2px solid #7c5cfc",
            borderRadius: 10,
            padding: "10px 15px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "#e0e0e0",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700, color: "#7c5cfc" }}>🪞 ESPEJO</span>
          <span style={{ color: "#888" }}>https://sitio-ejemplo.com/pagina</span>
          <button style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 600 }}>
            ⬇️ Descargar página
          </button>
          <button style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600 }}>
            📋 Recursos
          </button>
          <button style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#555", color: "#fff", fontSize: 12, fontWeight: 600 }}>
            🏠 Inicio
          </button>
        </div>
        <p style={{ color: "#888", fontSize: "0.85em", marginTop: 10, lineHeight: 1.5 }}>
          <strong>📋 Recursos</strong> abre un panel lateral que lista TODAS las imágenes, links, videos, CSS y JS de la página. 
          Cada uno tiene un botón <strong>⬇</strong> para descargar y <strong>🔗</strong> para abrir.
        </p>
      </div>

      {/* Ejemplos rápidos */}
      <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 25, border: "1px solid #2a2a3e" }}>
        <h2 style={{ fontSize: "1.3em", marginBottom: 15, color: "#fbbf24" }}>⚡ Probar rápido</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {EXAMPLE_SITES.map((site) => (
            <button
              key={site.url}
              onClick={() => { setUrl(site.url); goMirror(site.url); }}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "1px solid #2a2a3e",
                background: "#2a2a3e",
                color: "#ccc",
                cursor: "pointer",
                fontSize: "0.9em",
              }}
            >
              {site.name}
            </button>
          ))}
        </div>
        <p style={{ color: "#555", fontSize: "0.8em", marginTop: 12 }}>
          ⚠️ Algunos sitios (Instagram, Twitter, Reddit) bloquean peticiones de servidores y no funcionarán.
        </p>
      </div>
    </div>
  );
}

function Step({ num, text, icon }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "#7c5cfc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1em",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ color: "#aaa", fontSize: "0.9em", lineHeight: 1.4 }}>{text}</div>
    </div>
  );
}
