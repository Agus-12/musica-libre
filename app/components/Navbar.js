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

const ICON_MUSIC = <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>;
const ICON_USER = <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>;
const ICON_LOGOUT = <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>;

export default function Navbar({ children }) {
  const { user, profile, logout } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [temaClaro, setTemaClaro] = useState(false);
  const [sinDatos, setSinDatos] = useState(false);
  useEffect(() => {
    try { setSinDatos(localStorage.getItem("aura_sin_datos") === "1"); } catch {}
    const alCambiar = (e) => setSinDatos(Boolean(e.detail));
    window.addEventListener("aura-sin-datos", alCambiar);
    return () => window.removeEventListener("aura-sin-datos", alCambiar);
  }, []);
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

  // Modo claro: se guarda la preferencia y se aplica una clase en <html>.
  useEffect(() => {
    try {
      const claro = localStorage.getItem("aura_tema") === "claro";
      setTemaClaro(claro);
      document.documentElement.classList.toggle("tema-claro", claro);
    } catch {}
  }, []);
  function toggleTema() {
    // Estado REAL desde el DOM (así nunca se desincroniza con el panel
    // de Personalizar del perfil, que también cambia el tema).
    const d = document.documentElement;
    const nuevo = !d.classList.contains("tema-claro");
    setTemaClaro(nuevo);
    d.classList.toggle("tema-claro", nuevo);
    try { localStorage.setItem("aura_tema", nuevo ? "claro" : "oscuro"); } catch {}
  }

  const links = [
    { href: "/spotify", icon: ICON_MUSIC, label: "Música" },
    { href: "/profile", icon: ICON_USER, label: "Perfil" },
  ];

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
          {/* Logo */}
          <a href="/spotify" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 9, marginRight: "auto" }}>
            <LogoAura height={24} />
          </a>

          {/* Desktop links */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }} className="desktop-nav">
            {links.map(l => (
              <a key={l.href} href={l.href} style={{
                padding: "8px 14px", borderRadius: 8, textDecoration: "none",
                color: "#aaa", fontSize: "0.85em", fontWeight: 500,
                transition: "color 0.15s, background 0.15s",
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <Ico d={l.icon} size={16} stroke="currentColor" /> {l.label}
              </a>
            ))}
          </div>

          {/* User info + logout */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
            {/* Tema claro/oscuro: siempre a la vista, junto al avatar */}
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
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--accent), #1ed760)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.85em", fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {(profile?.display_name || profile?.username || "U")[0].toUpperCase()}
            </div>
            <span style={{ color: "#aaa", fontSize: "0.8em", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="desktop-nav">
              {profile?.username || ""}
            </span>
          </div>

          {/* Mobile menu button */}
          <button onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            style={{
              display: "none", background: "none", border: "none",
              color: "#aaa", fontSize: "1.4em", cursor: "pointer", marginLeft: 8,
              /* 44x44 es el mínimo que recomienda Apple para poder tocarlo bien */
              width: 44, height: 44, padding: 0, alignItems: "center",
              justifyContent: "center", flexShrink: 0, position: "relative", zIndex: 2,
            }} className="mobile-menu-btn">
            {menuOpen ? "✕" : "☰"}
            {sinDatos && !menuOpen && <span style={{ position: "absolute", top: 9, right: 7, width: 8, height: 8, borderRadius: "50%", background: "#eab308" }} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div style={{
            padding: "10px 16px calc(18px + env(safe-area-inset-bottom))",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex", flexDirection: "column", gap: 8,
            maxHeight: "72vh", overflowY: "auto",
            background: "rgba(10,10,20,0.72)",
            backdropFilter: "blur(24px) saturate(1.4)",
            WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          }} className="mobile-dropdown">
            {links.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "13px 14px", borderRadius: 14, textDecoration: "none",
                color: "#e6e6f0", fontSize: "0.95em", fontWeight: 600,
                background: "rgba(255,255,255,0.045)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(124,92,252,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Ico d={l.icon} size={17} stroke="var(--accent)" />
                </span>
                <span style={{ flex: 1 }}>{l.label}</span>
                <Ico d={<polyline points="9 18 15 12 9 6"/>} size={14} stroke="rgba(255,255,255,0.25)" />
              </a>
            ))}

            {/* Modo sin datos: a la vista, con switch */}
            <button onClick={toggleSinDatos} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "13px 14px", borderRadius: 14, border: sinDatos ? "1px solid rgba(234,179,8,0.35)" : "1px solid rgba(255,255,255,0.07)",
              background: sinDatos ? "rgba(234,179,8,0.09)" : "rgba(255,255,255,0.045)",
              color: "#e6e6f0", fontSize: "0.95em", fontWeight: 600, cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: sinDatos ? "rgba(234,179,8,0.18)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Ico d={<><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>} size={17} stroke={sinDatos ? "#eab308" : "#8a8a9a"} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                Modo sin datos
                <span style={{ display: "block", fontSize: "0.72em", fontWeight: 500, color: "rgba(230,230,240,0.45)", marginTop: 2 }}>
                  {sinDatos ? "Activo: solo tu música descargada" : "La app no tocará internet"}
                </span>
              </span>
              {/* Switch */}
              <span style={{ width: 46, height: 27, borderRadius: 14, background: sinDatos ? "#eab308" : "rgba(255,255,255,0.14)", position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                <span style={{ position: "absolute", top: 3, left: sinDatos ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }} />
              </span>
            </button>

            <button onClick={() => { logout(); setMenuOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "13px 14px", borderRadius: 14, border: "1px solid rgba(239,68,68,0.18)",
              background: "rgba(239,68,68,0.07)",
              color: "#ef4444", fontSize: "0.95em", fontWeight: 700, cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(239,68,68,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Ico d={ICON_LOGOUT} size={17} stroke="#ef4444" />
              </span>
              Cerrar sesión
            </button>
          </div>
        )}
      </nav>

      {/* Page content */}
      <main>{children}</main>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 641px) {
          .mobile-dropdown { display: none !important; }
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </div>
  );
}
