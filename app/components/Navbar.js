"use client";
import { useState } from "react";
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
  const { user, profile, checkSession } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    checkSession();
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
        borderBottom: "1px solid rgba(42,42,62,0.5)",
        padding: "0 16px",
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", alignItems: "center", height: 56 }}>
          {/* Logo */}
          <a href="/spotify" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 9, marginRight: "auto" }}>
            <Ico d={ICON_MUSIC} size={20} stroke="#1ed760" />
            <span style={{ fontWeight: 700, fontSize: "1.1em", color: "#e0e0e0" }}>
              Música <span style={{ color: "#1ed760" }}>Libre</span>
            </span>
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
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, #7c5cfc, #1ed760)",
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
          <button onClick={() => setMenuOpen(!menuOpen)} style={{
            display: "none", background: "none", border: "none",
            color: "#aaa", fontSize: "1.4em", cursor: "pointer", marginLeft: 8, padding: 4,
          }} className="mobile-menu-btn">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div style={{
            padding: "8px 16px 16px", borderTop: "1px solid rgba(42,42,62,0.5)",
            display: "flex", flexDirection: "column", gap: 4,
          }} className="mobile-dropdown">
            {links.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} style={{
                padding: "12px 14px", borderRadius: 8, textDecoration: "none",
                color: "#ccc", fontSize: "0.95em", display: "flex", alignItems: "center", gap: 11,
                background: "rgba(26,26,46,0.5)",
              }}>
                <Ico d={l.icon} size={18} stroke="#7c5cfc" /> {l.label}
              </a>
            ))}
            <button onClick={logout} style={{
              padding: "12px 14px", borderRadius: 8, border: "none",
              color: "#ef4444", fontSize: "0.95em", cursor: "pointer", textAlign: "left",
              background: "rgba(239,68,68,0.05)", display: "flex", alignItems: "center", gap: 11,
            }}>
              <Ico d={ICON_LOGOUT} size={18} stroke="#ef4444" /> Cerrar sesión
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
          .mobile-menu-btn { display: block !important; }
        }
        @media (min-width: 641px) {
          .mobile-dropdown { display: none !important; }
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </div>
  );
}
