"use client";
import { useState } from "react";
import { useUser } from "./UserContext";

export default function Navbar({ children }) {
  const { user, profile, checkSession } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    checkSession();
  }

  const links = [
    { href: "/spotify", icon: "🎵", label: "Música" },
    { href: "/profile", icon: "👤", label: "Perfil" },
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
          <a href="/spotify" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
            <span style={{ fontSize: "1.4em" }}>🎵</span>
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
              }}>
                {l.icon} {l.label}
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
                color: "#ccc", fontSize: "0.95em", display: "flex", alignItems: "center", gap: 10,
                background: "rgba(26,26,46,0.5)",
              }}>
                <span style={{ fontSize: "1.2em" }}>{l.icon}</span> {l.label}
              </a>
            ))}
            <button onClick={logout} style={{
              padding: "12px 14px", borderRadius: 8, border: "none",
              color: "#ef4444", fontSize: "0.95em", cursor: "pointer", textAlign: "left",
              background: "rgba(239,68,68,0.05)", display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: "1.2em" }}>🚪</span> Cerrar sesión
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
