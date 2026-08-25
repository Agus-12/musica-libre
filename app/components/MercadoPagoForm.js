"use client";
import { useEffect, useId, useRef, useState } from "react";

export default function MercadoPagoForm({ publicKey, amount, plan, onDone, onCancel }) {
  const idBase = useId().replace(/:/g, "");
  const containerId = `mp-card-brick-${idBase}`;
  const brick = useRef(null);
  const onDoneRef = useRef(onDone);
  const [error, setError] = useState("");
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    let cancelado = false;
    let script;
    const cargar = () => {
      if (cancelado || brick.current || !document.getElementById(containerId) || !window.MercadoPago) return;
      try {
        const mp = new window.MercadoPago(publicKey, { locale: "es-MX" });
        mp.bricks().create("cardPayment", containerId, {
          initialization: { amount },
          customization: { visual: { style: { theme: "default" } }, paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => {},
            onSubmit: async (formData) => {
              setError("");
              const r = await fetch("/api/pagos/crear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, card: formData }) });
              const d = await r.json().catch(() => ({}));
              if (!r.ok) { const detalle = typeof d.detalle === "string" ? d.detalle : ""; setError([d.error, detalle].filter(Boolean).join(": ")); return; }
              onDoneRef.current?.(d);
            },
            onError: (e) => { if (!cancelado) setError(e?.cause?.[0]?.description || "No se pudo cargar el formulario de pago"); },
          },
        }).then(x => { if (!cancelado) brick.current = x; else { try { x.unmount(); } catch {} } }).catch(e => { if (!cancelado) setError(String(e?.message || "No se pudo cargar Mercado Pago")); });
      } catch (e) { if (!cancelado) setError(String(e?.message || "No se pudo cargar Mercado Pago")); }
    };
    if (window.MercadoPago) cargar();
    else {
      script = document.createElement("script"); script.src = "https://sdk.mercadopago.com/js/v2"; script.onload = cargar; script.onerror = () => setError("No se pudo cargar Mercado Pago"); document.head.appendChild(script);
    }
    return () => { cancelado = true; try { brick.current?.unmount(); } catch {} brick.current = null; };
  }, [publicKey, amount, plan, containerId]);
  return <div style={{marginTop:12}}><div id={containerId}/>{error && <div style={{marginTop:8,color:"#ef4444",fontSize:"0.78em",lineHeight:1.4}}>{error}</div>}<button onClick={onCancel} style={{marginTop:9,padding:"7px 11px",borderRadius:8,border:"1px solid var(--border)",background:"var(--panel2)",color:"var(--text3)",fontSize:"0.75em",cursor:"pointer"}}>Cancelar</button></div>;
}
