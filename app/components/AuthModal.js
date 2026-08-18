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

  const IS = { padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text-strong)", fontSize: "1em", outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div style={{ background: "#0f0f1a", borderRadius: 16, padding: 30, maxWidth: 420, width: "100%", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: "1.5em", marginBottom: 5, textAlign: "center" }}>
          🎵 {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </h2>
        <p style={{ color: "var(--text3)", textAlign: "center", marginBottom: 20, fontSize: "0.9em" }}>
          {mode === "login" ? "Entrá a tu cuenta para guardar favoritos y playlists" : "Creá tu cuenta gratis"}
        </p>



        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <div>
              <label style={{ color: "var(--text3)", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Nombre de usuario</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="tu_usuario" style={IS} required />
            </div>
          )}
          <div>
            <label style={{ color: "var(--text3)", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" style={IS} required />
          </div>
          <div>
            <label style={{ color: "var(--text3)", fontSize: "0.8em", marginBottom: 3, display: "block" }}>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" style={IS} required minLength={6} />
          </div>

          {error && <div style={{ color: "#ef4444", fontSize: "0.85em", padding: "8px 12px", background: "#2e1a1a", borderRadius: 8 }}>❌ {error}</div>}
          {success && <div style={{ color: "#22c55e", fontSize: "0.85em", padding: "8px 12px", background: "#1a2e1a", borderRadius: 8 }}>✅ {success}</div>}

          <button type="submit" disabled={loading} style={{ padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 600 }}>
            {loading ? "⏳" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 15, color: "var(--text3)", fontSize: "0.85em" }}>
          {mode === "login" ? (
            <>¿No tenés cuenta? <button onClick={() => { setMode("register"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>Registrate</button></>
          ) : (
            <>¿Ya tenés cuenta? <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>Iniciá sesión</button></>
          )}
        </div>

        <button onClick={onClose} style={{ position: "absolute", top: 15, right: 20, background: "none", border: "none", color: "var(--text5)", fontSize: "1.5em", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
