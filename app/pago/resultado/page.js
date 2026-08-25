"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
export default function PagoResultado() {
  const p = useSearchParams();
  const estado = p.get("estado") || "exito";
  const [real, setReal] = useState({ cargando: estado === "exito", activo: false, intentos: 0 });
  const timer = useRef(null);
  /* Verifica de verdad la suscripción: el webhook tarda unos segundos en
     activarla, así que consultamos /api/pagos/estado hasta 4 veces. */
  useEffect(() => {
    if (estado !== "exito") return;
    let cancelado = false;
    const consultar = async () => {
      try {
        const r = await fetch("/api/pagos/estado", { cache: "no-store" });
        const d = await r.json();
        if (cancelado) return;
        if (d.activo) { setReal({ cargando: false, activo: true, intentos: 0 }); return; }
      } catch {}
      if (cancelado) return;
      setReal(v => {
        const intentos = v.intentos + 1;
        if (intentos >= 4) return { cargando: false, activo: false, intentos };
        timer.current = setTimeout(consultar, 2500);
        return { cargando: true, activo: false, intentos };
      });
    };
    consultar();
    return () => { cancelado = true; clearTimeout(timer.current); };
  }, [estado]);
  const ok = estado === "exito";
  const titulo = ok ? (real.cargando ? "Verificando tu pago…" : real.activo ? "¡Premium activado!" : "Pago en revisión") : "Pago no completado";
  const detalle = ok
    ? (real.cargando ? "Mercado Pago recibió tu pago. Confirmando tu suscripción…" : real.activo ? "Tu suscripción AURA Premium ya está activa. ¡Disfruta todo el contenido!" : "Todavía no vemos la suscripción activa. Espera unos segundos o vuelve a AURA.")
    : (estado === "fallo" ? "El pago no se completó. Puedes intentarlo de nuevo desde tu cuenta." : "El pago quedó pendiente de aprobación. Te avisaremos cuando se confirme.");
  return <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:"#0b0b12",color:"#f5f5f5",fontFamily:"system-ui,sans-serif"}}><section style={{maxWidth:420,textAlign:"center",background:"#171722",border:"1px solid #303044",borderRadius:18,padding:28}}><div style={{fontSize:36,marginBottom:12,color:ok?(real.activo?"#22c55e":"#f59e0b"):"#ef4444"}}>{ok?(real.activo?"✓":"…"):"!"}</div><h1 style={{fontSize:22,margin:"0 0 10px"}}>{titulo}</h1><p style={{color:"#aaa",lineHeight:1.5,marginBottom:20}}>{detalle}</p><a href="/profile" style={{display:"inline-block",padding:"11px 18px",borderRadius:10,background:"#7c5cfc",color:"#fff",textDecoration:"none",fontWeight:700}}>Volver a AURA</a></section></main>;
}
