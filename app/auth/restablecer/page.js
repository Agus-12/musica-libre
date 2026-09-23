"use client";
import { useEffect, useState } from "react";
import LogoAura from "../../components/LogoAura";
import { createClient } from "../../utils/supabase/client";

export default function RestablecerPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
        if (hash.get("access_token") && hash.get("refresh_token")) {
          await createClient().auth.setSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") });
          history.replaceState(null, "", "/auth/restablecer");
        }
        const { data } = await createClient().auth.getUser();
        if (data?.user) setReady(true); else setError("El enlace venció o ya fue utilizado.");
      } catch { setError("No se pudo validar el enlace."); }
    })();
  }, []);
  async function guardar(e) {
    e.preventDefault(); setError(""); setMensaje("");
    if (password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setGuardando(true);
    const { error: e2 } = await createClient().auth.updateUser({ password });
    if (e2) setError(e2.message); else setMensaje("Contraseña actualizada. Ya puedes entrar a AURA.");
    setGuardando(false);
  }
  return <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:"#0a0a14",color:"#fff",fontFamily:"system-ui,sans-serif"}}><form onSubmit={guardar} style={{width:"100%",maxWidth:400,background:"#171722",border:"1px solid #303044",borderRadius:16,padding:24}}><div style={{display:"flex",justifyContent:"center",marginBottom:20}}><LogoAura height={38}/></div><h1 style={{fontSize:22,margin:"0 0 16px",textAlign:"center"}}>Restablecer contraseña</h1>{!ready&&!error&&<p style={{color:"#aaa",textAlign:"center"}}>Validando enlace…</p>}{ready&&<><input type="password" placeholder="Nueva contraseña" value={password} onChange={e=>setPassword(e.target.value)} style={IN} required minLength={6}/><input type="password" placeholder="Repite la contraseña" value={confirm} onChange={e=>setConfirm(e.target.value)} style={{...IN,marginTop:10}} required minLength={6}/><button disabled={guardando} style={BTN}>{guardando?"Guardando…":"Cambiar contraseña"}</button></>}{error&&<p style={{color:"#ef4444",fontSize:14,lineHeight:1.4}}>{error}</p>}{mensaje&&<><p style={{color:"#22c55e",fontSize:14}}>{mensaje}</p><a href="/profile" style={{color:"#a78bfa",display:"block",textAlign:"center"}}>Entrar a AURA</a></>}</form></main>;
}
const IN={width:"100%",boxSizing:"border-box",padding:"12px",borderRadius:9,border:"1px solid #373752",background:"#10101b",color:"#fff",fontSize:16};
const BTN={width:"100%",marginTop:12,padding:"12px",border:0,borderRadius:9,background:"#7c5cfc",color:"#fff",fontWeight:700,fontSize:15};
