"use client";
import { useEffect, useRef, useState } from "react";

export default function MercadoPagoForm({ publicKey, amount, plan, onDone, onCancel }) {
  const ref = useRef(null);
  const brick = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelado = false;
    const cargar = () => {
      if (cancelado || !ref.current || !window.MercadoPago) return;
      try {
        const mp = new window.MercadoPago(publicKey, { locale: "es-MX" });
        mp.bricks().create("cardPayment", ref.current.id, {
          initialization: { amount },
          customization: { visual: { style: { theme: "default" } }, paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => {},
            onSubmit: async (formData) => {
              setError("");
              const r = await fetch("/api/pagos/crear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, card: formData }) });
              const d = await r.json().catch(() => ({}));
              if (!r.ok) { const detalle = typeof d.detalle === "string" ? d.detalle : ""; setError([d.error, detalle].filter(Boolean).join(": ")); return; }
              onDone?.(d);
            },
            onError: (e) => setError(e?.cause?.[0]?.description || "No se pudo cargar el formulario de pago"),
          },
        }).then(x => { brick.current = x; }).catch(e => setError(String(e?.message || "No se pudo cargar Mercado Pago")));
      } catch (e) { setError(String(e?.message || "No se pudo cargar Mercado Pago")); }
    };
    if (window.MercadoPago) cargar();
    else {
      const s = document.createElement("script"); s.src = "https://sdk.mercadopago.com/js/v2"; s.onload = cargar; s.onerror = () => setError("No se pudo cargar Mercado Pago"); document.head.appendChild(s);
    }
    return () => { cancelado = true; try { brick.current?.unmount(); } catch {} };
  }, [publicKey, amount, plan, onDone]);
  return <div style={{marginTop:12}}><div id="mp-card-brick" ref={ref}/>{error && <div style={{marginTop:8,color:"#ef4444",fontSize:"0.78em",lineHeight:1.4}}>{error}</div>}<button onClick={onCancel} style={{marginTop:9,padding:"7px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text3)",fontSize:"0.75em",cursor:"pointer"}}>Cancelar</button></div>;
}
