"use client";
import { useState, useEffect } from "react";
import { useUser } from "./UserContext";
import LogoAura from "./LogoAura";
import Navbar from "./Navbar";

// Iconos SVG (mismo estilo de línea que el resto de la app)
function Ico({ d, size = 16, fill = "none", stroke = "#7c5cfc", sw = 2 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{d}</svg>;
}

// Rutas públicas que no requieren login
const PUBLIC_PATHS = ["/share", "/auth"];

export default function AuthGate({ children }) {
  const { user, loading, checkSession } = useUser();
  const [isPublic, setIsPublic] = useState(false);
  const [mode, setMode] = useState(null); // null = landing, "login", "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    setIsPublic(PUBLIC_PATHS.some(p => path.startsWith(p)));
    const hash = window.location.hash || "";
    const q = window.location.search || "";
    if (path !== "/auth/listo" && (hash.includes("access_token") || /[?&](code|token_hash)=/.test(q))) {
      window.location.replace("/auth/listo" + q + hash);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a14" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 14, animation: "pulse 1.5s infinite" }}><LogoAura height={40} /></div>
          <p style={{ color: "#7c5cfc", fontSize: "1.1em" }}>Cargando...</p>
        </div>
        <style>{`@keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.95); } }`}</style>
      </div>
    );
  }

  if (isPublic) return children;
  if (user) return <Navbar>{children}</Navbar>;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true); setError(""); setSuccess("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { action: "login", email, password }
            : { action: "register", email, password, username }
        ),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (mode === "register" && !data.session) {
        setSuccess("¡Registrado! Revisá tu email para confirmar tu cuenta y después iniciá sesión.");
      } else {
        await checkSession();
      }
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  }

  const IN = { width: "100%", padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(124,92,252,0.3)", background: "rgba(var(--panel-rgb),0.8)", color: "#fff", fontSize: "1em", outline: "none", boxSizing: "border-box", transition: "border-color 0.2s" };
  const BTN = { width: "100%", padding: "14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #7c5cfc, #5a3fd6)", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 700, letterSpacing: 0.5, transition: "transform 0.15s, box-shadow 0.15s" };

  // ── LANDING (not login/register yet) ──
  if (!mode) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0a0a14 0%, #0f0f1a 40%, #0a1a0f 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px", position: "relative", overflow: "hidden" }}>
        {/* Decorative blobs */}
        <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(124,92,252,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-20%", left: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(30,215,96,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ maxWidth: 460, width: "100%", textAlign: "center", position: "relative", zIndex: 1 }}>
          {/* Logo */}
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}>
            <LogoAura height={40} />
          </div>
          <p style={{ color: "#6a6a80", fontSize: "0.8em", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6, marginTop: 14 }}>Tu música, siempre contigo</p>
          <p style={{ color: "#888", fontSize: "clamp(0.9em, 2.5vw, 1.05em)", marginBottom: 35, lineHeight: 1.5, maxWidth: 380, margin: "0 auto 35px" }}>
            Busca álbumes, descarga canciones y escucha sin conexión
          </p>

          {/* Features */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 35, textAlign: "left" }}>
            {[
              { icon: <Ico d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} size="18" stroke="#7c5cfc" />, text: "Buscar álbumes y artistas" },
              { icon: <Ico d={<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>} size="18" stroke="#22c55e" />, text: "Descargar música" },
              { icon: <Ico d={<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />} size="18" stroke="#ef4444" fill="#ef4444" />, text: "Guardar favoritos" },
              { icon: <Ico d={<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3" cy="6" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="18" r="1" /></>} size="18" stroke="#7c5cfc" />, text: "Crear playlists" },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(var(--panel-rgb),0.6)", border: "1px solid rgba(var(--border-rgb),0.5)" }}>
                {f.icon}
                <span style={{ color: "#aaa", fontSize: "0.8em", lineHeight: 1.3 }}>{f.text}</span>
              </div>
            ))}
          </div>

          {/* CTA buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320, margin: "0 auto" }}>
            <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={{ ...BTN, padding: "16px", fontSize: "1.05em" }}>
              Iniciar sesión
            </button>
            <button onClick={() => { setMode("register"); setError(""); setSuccess(""); }} style={{ ...BTN, background: "transparent", border: "2px solid rgba(124,92,252,0.4)", color: "#7c5cfc" }}>
              Crear cuenta gratis
            </button>
          </div>

          <p style={{ color: "#444", fontSize: "0.75em", marginTop: 25 }}>
            Gratis • Sin cuenta Premium
          </p>
        </div>
      </div>
    );
  }

  // ── LOGIN / REGISTER form ──
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0a0a14 0%, #0f0f1a 50%, #0a1a0f 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px", position: "relative", overflow: "hidden" }}>
      {/* Decorative blobs */}
      <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(124,92,252,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 400, width: "100%", position: "relative", zIndex: 1 }}>
        {/* Back button */}
        <button onClick={() => { setMode(null); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.9em", marginBottom: 20, display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
          ← Volver
        </button>

        <div style={{ textAlign: "center", marginBottom: 25, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <LogoAura height={40} />
          <h2 style={{ fontSize: "1.6em", marginBottom: 4 }}>
            {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </h2>
          <p style={{ color: "#888", fontSize: "0.9em" }}>
            {mode === "login" ? "Entrá a tu cuenta" : "Es gratis y tarda 10 segundos"}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "register" && (
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 4, display: "block" }}>Nombre de usuario</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="tu_usuario" style={IN} required />
            </div>
          )}
          <div>
            <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 4, display: "block" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" style={IN} required />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 4, display: "block" }}>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" style={IN} required minLength={6} />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: "0.85em" }}>
              ❌ {error}
            </div>
          )}
          {success && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e", fontSize: "0.85em" }}>
              ✅ {success}
            </div>
          )}

          <button type="submit" disabled={submitting} style={{ ...BTN, marginTop: 5, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "⏳ Esperá..." : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, color: "#888", fontSize: "0.85em" }}>
          {mode === "login" ? (
            <>¿No tenés cuenta? <button onClick={() => { setMode("register"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", fontWeight: 600 }}>Registrate</button></>
          ) : (
            <>¿Ya tenés cuenta? <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", fontWeight: 600 }}>Iniciá sesión</button></>
          )}
        </div>
      </div>
    </div>
  );
}
