"use client";
import { useSearchParams } from "next/navigation";
export default function PagoResultado() {
  const p = useSearchParams();
  const estado = p.get("estado") || "exito";
  const ok = estado === "exito";
  return <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:"#0b0b12",color:"#f5f5f5",fontFamily:"system-ui,sans-serif"}}><section style={{maxWidth:420,textAlign:"center",background:"#171722",border:"1px solid #303044",borderRadius:18,padding:28}}><div style={{fontSize:36,marginBottom:12,color:ok?"#22c55e":"#f59e0b"}}>{ok?"✓":"!"}</div><h1 style={{fontSize:22,margin:"0 0 10px"}}>{ok?"Pago recibido":"Pago en revisión"}</h1><p style={{color:"#aaa",lineHeight:1.5,marginBottom:20}}>{ok?"Mercado Pago recibió tu pago. Regresa a AURA para actualizar tu estado Premium.":"Mercado Pago todavía está procesando el pago. Regresa a AURA en unos segundos."}</p><a href="/profile" style={{display:"inline-block",padding:"11px 18px",borderRadius:10,background:"#7c5cfc",color:"#fff",textDecoration:"none",fontWeight:700}}>Volver a AURA</a></section></main>;
}
