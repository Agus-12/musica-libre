"use client";
import { useState, useEffect } from "react";
import LogoAura from "./LogoAura";
import { useUser } from "./UserContext";

// Iconos SVG con el mismo trazo que el resto de la app (línea de 2px, 24x24)
function Ico({ d, size = 16, stroke = "currentColor", fill = "none", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
         strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      {d}
    </svg>
  );
}

const ICON_EXPLORAR = <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />;
const ICON_MUSIC = <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>;
const ICON_PLAYLIST = <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></>;
const ICON_USER = <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>;
const ICON_LOGOUT = <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>;
const ICON_SINDATOS = <><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>;

export default function Navbar({ children }) {
  const { user, profile, logout } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [temaClaro, setTemaClaro] = useState(false);
  const [sinDatos, setSinDatos] = useState(false);

  useEffect(() => {
    try {
      const claro = localStorage.getItem("aura_tema") === "claro";
      setTemaClaro(claro);
      document.documentElement.classList.toggle("tema-claro", claro);
      setSinDatos(localStorage.getItem("aura_sin_datos") === "1");
    } catch {}
    const alCambiar = (e) => setSinDatos(Boolean(e.detail));
    window.addEventListener("aura-sin-datos", alCambiar);
    return () => window.removeEventListener("aura-sin-datos", alCambiar);
  }, []);

  function toggleTema() {
    const d = document.documentElement;
    const nuevo = !d.classList.contains("tema-claro");
    setTemaClaro(nuevo);
    d.classList.toggle("tema-claro", nuevo);
    try { localStorage.setItem("aura_tema", nuevo ? "claro" : "oscuro"); } catch {}
  }

  async function toggleSinDatos() {
    const nuevo = !sinDatos;
    setSinDatos(nuevo);
    try {
      localStorage.setItem("aura_sin_datos", nuevo ? "1" : "");
      const c = await caches.open("ml-config");
      if (nuevo) await c.put("modo-sin-datos", new Response("1"));
      else await c.delete("modo-sin-datos");
      window.dispatchEvent(new CustomEvent("aura-sin-datos", { detail: nuevo }));
    } catch {}
  }

  /* Navegar a una sección del perfil SIN recargar cuando ya estamos ahí:
     la música que suena en Mi música / Mis playlists / Perfil no se corta. */
  function irASeccion(vista) {
    try { localStorage.setItem("aura_vista", vista); } catch {}
    setMenuOpen(false);
    if (typeof window !== "undefined" && window.location.pathname === "/profile") {
      window.dispatchEvent(new CustomEvent("aura-vista", { detail: vista }));
    } else {
      window.location.href = "/profile";
    }
  }

  const seccionesPerfil = [
    { vista: "musica", icon: ICON_MUSIC, label: "Mi música", tinte: "34,197,94" },
    { vista: "playlists", icon: ICON_PLAYLIST, label: "Mis playlists", tinte: "236,72,153" },
    { vista: "cuenta", icon: ICON_USER, label: "Perfil", tinte: "56,189,248" },
  ];

  const itemDrawer = {
    display: "flex", alignItems: "center", gap: 13, width: "100%",
    padding: "14px 14px", borderRadius: 16, textDecoration: "none",
    color: "#eceof2", fontSize: "0.96em", fontWeight: 700,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    cursor: "pointer", textAlign: "left",
  };
  const chip = (rgb) => ({
    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
    background: `rgba(${rgb},0.16)`, display: "flex", alignItems: "center", justifyContent: "center",
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Top nav */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(15,15,26,0.95)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(var(--border-rgb),0.5)",
        padding: "0 16px",
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "max(16px, env(safe-area-inset-left))",
        paddingRight: "max(16px, env(safe-area-inset-right))",
        boxSizing: "border-box",
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", height: 56 }}>
          {/* Menú lateral (izquierda, junto al logo) */}
          <button onClick={() => setMenuOpen(true)} aria-label="Abrir menú"
            style={{
              background: "none", border: "none", color: "#aaa", fontSize: "1.35em",
              cursor: "pointer", width: 44, height: 44, padding: 0, marginLeft: -10,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, position: "relative",
            }}>
            ☰
            {sinDatos && <span style={{ position: "absolute", top: 9, right: 7, width: 8, height: 8, borderRadius: "50%", background: "#eab308" }} />}
          </button>

          {/* Logo */}
          <a href="/spotify" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 9, marginRight: "auto", marginLeft: 4 }}>
            <LogoAura height={24} />
          </a>

          {/* Desktop links */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }} className="desktop-nav">
            <a href="/spotify" style={{ padding: "8px 14px", borderRadius: 8, textDecoration: "none", color: "#aaa", fontSize: "0.85em", fontWeight: 500, display: "flex", alignItems: "center", gap: 7 }}>
              <Ico d={ICON_EXPLORAR} size={15} stroke="currentColor" /> Explorar
            </a>
            {seccionesPerfil.map(s => (
              <button key={s.vista} onClick={() => irASeccion(s.vista)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "none", color: "#aaa", fontSize: "0.85em", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                <Ico d={s.icon} size={15} stroke="currentColor" /> {s.label}
              </button>
            ))}
          </div>

          {/* Tema + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
            <button onClick={toggleTema} aria-label="Cambiar tema" style={{
              background: "none", border: "none", cursor: "pointer",
              width: 38, height: 38, display: "flex", alignItems: "center",
              justifyContent: "center", flexShrink: 0, borderRadius: "50%",
            }}>
              <Ico d={temaClaro
                ? <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                : <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>}
                size={19} stroke="#eab308" />
            </button>
            <button onClick={() => irASeccion("cuenta")} title="Perfil" style={{
              width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, var(--accent), #1ed760)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.85em", fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {(profile?.display_name || profile?.username || "U")[0].toUpperCase()}
            </button>
          </div>
        </div>
      </nav>

      {/* ── DRAWER lateral: liquid glass, desliza de izquierda a derecha ── */}
      {/* Fondo (tap para cerrar) */}
      <div onClick={() => setMenuOpen(false)} style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.45)",
        opacity: menuOpen ? 1 : 0,
        pointerEvents: menuOpen ? "auto" : "none",
        transition: "opacity 0.28s ease",
      }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 201,
        width: "min(78vw, 320px)",
        transform: menuOpen ? "translateX(0)" : "translateX(-105%)",
        transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
        background: "linear-gradient(165deg, rgba(124,92,252,0.16) 0%, rgba(15,15,28,0.55) 38%, rgba(8,8,18,0.62) 100%)",
        backdropFilter: "blur(30px) saturate(1.7)",
        WebkitBackdropFilter: "blur(30px) saturate(1.7)",
        borderRight: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "12px 0 50px rgba(0,0,0,0.45)",
        display: "flex", flexDirection: "column",
        padding: "calc(14px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom))",
        boxSizing: "border-box", overflowY: "auto",
      }}>
        {/* Cabecera del drawer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 16px" }}>
          <LogoAura height={22} />
          <button onClick={() => setMenuOpen(false)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", color: "#cfcfda", fontSize: "0.95em" }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {/* 1. Explorar */}
          <a href="/spotify" onClick={() => setMenuOpen(false)} style={itemDrawer}>
            <span style={chip("124,92,252")}><Ico d={ICON_EXPLORAR} size={17} stroke="var(--accent)" /></span>
            <span style={{ flex: 1, color: "#eceff4" }}>Explorar</span>
            <Ico d={<polyline points="9 18 15 12 9 6"/>} size={14} stroke="rgba(255,255,255,0.25)" />
          </a>

          {/* 2-4. Mi música / Mis playlists / Perfil */}
          {seccionesPerfil.map(s => (
            <button key={s.vista} onClick={() => irASeccion(s.vista)} style={itemDrawer}>
              <span style={chip(s.tinte)}><Ico d={s.icon} size={17} stroke={`rgb(${s.tinte})`} /></span>
              <span style={{ flex: 1, color: "#eceff4" }}>{s.label}</span>
              <Ico d={<polyline points="9 18 15 12 9 6"/>} size={14} stroke="rgba(255,255,255,0.25)" />
            </button>
          ))}

          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "8px 4px" }} />

          {/* 5. Modo sin conexión (switch) */}
          <button onClick={toggleSinDatos} style={{
            ...itemDrawer,
            border: sinDatos ? "1px solid rgba(234,179,8,0.4)" : itemDrawer.border,
            background: sinDatos ? "rgba(234,179,8,0.1)" : itemDrawer.background,
          }}>
            <span style={chip("234,179,8")}><Ico d={ICON_SINDATOS} size={17} stroke={sinDatos ? "#eab308" : "#9a9aa8"} /></span>
            <span style={{ flex: 1, minWidth: 0, color: "#eceff4" }}>
              Modo sin conexión
              <span style={{ display: "block", fontSize: "0.7em", fontWeight: 500, color: "rgba(236,239,244,0.45)", marginTop: 2 }}>
                {sinDatos ? "Activo: solo tu música descargada" : "La app no tocará internet"}
              </span>
            </span>
            <span style={{ width: 46, height: 27, borderRadius: 14, background: sinDatos ? "#eab308" : "rgba(255,255,255,0.14)", position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
              <span style={{ position: "absolute", top: 3, left: sinDatos ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }} />
            </span>
          </button>

          {/* 6. Cerrar sesión */}
          <button onClick={() => { logout(); setMenuOpen(false); }} style={{
            ...itemDrawer,
            border: "1px solid rgba(239,68,68,0.22)",
            background: "rgba(239,68,68,0.08)",
            color: "#ef4444",
          }}>
            <span style={chip("239,68,68")}><Ico d={ICON_LOGOUT} size={17} stroke="#ef4444" /></span>
            <span style={{ flex: 1, color: "#ef4444" }}>Cerrar sesión</span>
          </button>
        </div>

        {/* Pie del drawer */}
        <div style={{ marginTop: "auto", paddingTop: 18, textAlign: "center", color: "rgba(236,239,244,0.3)", fontSize: "0.7em" }}>
          @{profile?.username || "aura"} · AURA
        </div>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
