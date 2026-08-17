"use client";
import { useState } from "react";
import { useUser } from "./UserContext";

export default function AuthModal({ onClose }) {
  const { checkSession } = useUser();
  const [mode, setMode] = useState("login"); // login, register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setSuccess("");

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
        setSuccess("¡Registrado! Revisá tu email para confirmar tu cuenta, y después iniciá sesión.");
      } else {
        await checkSession();
        onClose();
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleGoogleLogin() {
    // Redirect to Supabase OAuth
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const redirectUrl = window.location.origin + "/auth/callback";
    window.location.href = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
  }

  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div style={{ background: "#0f0f1a", borderRadius: 16, padding: 30, maxWidth: 420, width: "100%", border: "1px solid #2a2a3e" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: "1.5em", marginBottom: 5, textAlign: "center" }}>
          🎵 {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </h2>
        <p style={{ color: "#888", textAlign: "center", marginBottom: 20, fontSize: "0.9em" }}>
          {mode === "login" ? "Entrá a tu cuenta para guardar favoritos y playlists" : "Creá tu cuenta gratis"}
        </p>

        {/* Google login */}
        <button onClick={handleGoogleLogin} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #333", background: "#1a1a2e", color: "#fff", fontSize: "0.95em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 15 }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.18 3.33v2.77h3.53c2.07-1.87 3.29-4.62 3.29-8.11z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.53-2.77c-.98.66-2.23 1.06-3.75 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.07 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continuar con Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
          <div style={{ flex: 1, height: 1, background: "#333" }} />
          <span style={{ color: "#555", fontSize: "0.8em" }}>o con email</span>
          <div style={{ flex: 1, height: 1, background: "#333" }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Nombre de usuario</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="tu_usuario" style={IS} required />
            </div>
          )}
          <div>
            <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" style={IS} required />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" style={IS} required minLength={6} />
          </div>

          {error && <div style={{ color: "#ef4444", fontSize: "0.85em", padding: "8px 12px", background: "#2e1a1a", borderRadius: 8 }}>❌ {error}</div>}
          {success && <div style={{ color: "#22c55e", fontSize: "0.85em", padding: "8px 12px", background: "#1a2e1a", borderRadius: 8 }}>✅ {success}</div>}

          <button type="submit" disabled={loading} style={{ padding: "12px", borderRadius: 10, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 600 }}>
            {loading ? "⏳" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 15, color: "#888", fontSize: "0.85em" }}>
          {mode === "login" ? (
            <>¿No tenés cuenta? <button onClick={() => { setMode("register"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", fontWeight: 600 }}>Registrate</button></>
          ) : (
            <>¿Ya tenés cuenta? <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "#7c5cfc", cursor: "pointer", fontWeight: 600 }}>Iniciá sesión</button></>
          )}
        </div>

        <button onClick={onClose} style={{ position: "absolute", top: 15, right: 20, background: "none", border: "none", color: "#555", fontSize: "1.5em", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
