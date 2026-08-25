"use client";
import { useEffect, useState } from "react";
import LogoAura from "../../components/LogoAura";
import { createClient } from "../../utils/supabase/client";

export default function CuentaListaPage() {
  const [estado, setEstado] = useState("revisando"); // revisando | ok | login | error
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const supabase = createClient();
        const hash = String(window.location.hash || "").replace(/^#/, "");
        const hp = new URLSearchParams(hash);
        const access_token = hp.get("access_token");
        const refresh_token = hp.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          try { history.replaceState(null, "", "/auth/listo?ok=1"); } catch {}
        }
        const { data } = await supabase.auth.getUser();
        if (cancel) return;
        if (data?.user) {
          setEstado("ok");
          return;
        }
      } catch {}
      if (cancel) return;
      const q = new URLSearchParams(window.location.search);
      setEstado(q.get("ok") === "0" ? "error" : "ok");
    })();
    return () => { cancel = true; };
  }, []);

  async function entrar() {
    window.location.href = "/profile";
  }

  async function iniciarSesion(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else window.location.href = "/profile";
    } catch (err) {
      setError(err.message || "Error al entrar");
    }
    setSubmitting(false);
  }

  const IN = { width: "100%", padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(124,92,252,0.3)", background: "rgba(20,20,32,0.85)", color: "#fff", fontSize: "1em", outline: "none", boxSizing: "border-box" };
  const BTN = { width: "100%", padding: "14px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", fontSize: "1em", cursor: "pointer", fontWeight: 800 };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0a0a14 0%,#0f0f1a 50%,#0a1a0f 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><LogoAura height={40} /></div>

        {estado === "revisando" && (
          <p style={{ color: "#7c5cfc" }}>Confirmando tu cuenta…</p>
        )}

        {estado === "error" && (
          <>
            <h1 style={{ color: "#fff", fontSize: "1.45em", margin: "0 0 8px" }}>No se pudo confirmar</h1>
            <p style={{ color: "#8a8a9a", fontSize: "0.92em", lineHeight: 1.5, marginBottom: 18 }}>El link puede haber vencido. Creá la cuenta de nuevo o iniciá sesión si ya estaba confirmada.</p>
            <button onClick={() => { setEstado("login"); }} style={BTN}>Ir al login</button>
          </>
        )}

        {estado === "ok" && (
          <>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#22c55e", fontSize: "1.8em", fontWeight: 800 }}>✓</div>
            <h1 style={{ color: "#fff", fontSize: "1.45em", margin: "0 0 8px" }}>Cuenta aprobada con éxito</h1>
            <p style={{ color: "#8a8a9a", fontSize: "0.92em", lineHeight: 1.5, marginBottom: 22 }}>Tu email ya está confirmado. Ya podés entrar a AURA.</p>
            <button onClick={entrar} style={{ ...BTN, marginBottom: 10 }}>Entrar a AURA</button>
            <button onClick={() => setEstado("login")} style={{ ...BTN, background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#bbb", fontWeight: 700 }}>Iniciar sesión</button>
          </>
        )}

        {estado === "login" && (
          <form onSubmit={iniciarSesion} style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}>
            <h1 style={{ color: "#fff", fontSize: "1.35em", margin: "0 0 4px", textAlign: "center" }}>Iniciar sesión</h1>
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", display: "block", marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={IN} />
            </div>
            <div>
              <label style={{ color: "#888", fontSize: "0.8em", display: "block", marginBottom: 4 }}>Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} style={IN} />
            </div>
            {error && <div style={{ color: "#ef4444", fontSize: "0.85em" }}>{error}</div>}
            <button type="submit" disabled={submitting} style={{ ...BTN, opacity: submitting ? 0.7 : 1 }}>{submitting ? "Entrando…" : "Entrar"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
