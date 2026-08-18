"use client";
import { useState, useEffect, useRef } from "react";

/* Iconos SVG pequeños para los banners */
const Ic = ({ children, size = 18, stroke = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       style={{ flexShrink: 0 }}>{children}</svg>
);
const IcUpdate = (p) => <Ic {...p}><path d="M21 12a9 9 0 1 1-3.5-7.1" /><polyline points="21 4 21 12 13 12" /></Ic>;
const IcWifi = (p) => <Ic {...p}><line x1="1" y1="1" x2="23" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><line x1="2" y1="2" x2="22" y2="22" /></Ic>;
const IcMusic = (p) => <Ic {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Ic>;

export default function PWASetup() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hayUpdate, setHayUpdate] = useState(false);
  const [swEstado, setSwEstado] = useState("checking"); // checking | up-to-date | update-available
  const cleanupRef = useRef(null);

  useEffect(() => {
    /* Registro del service worker + detección de actualizaciones.

       El SW instala pero NO salta waiting solo (eso lo hace cuando el
       usuario toca "Actualizar"). Así la app sigue funcionando con la
       versión vieja hasta que el usuario decida actualizar. */
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg.update();

        // Buscar actualizaciones cada 60s y al volver a la app
        const buscar = () => { try { reg.update(); } catch {} };
        const t = setInterval(buscar, 60000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") buscar();
        });
        window.addEventListener("online", buscar);
        cleanupRef.current = () => clearInterval(t);

        // Cuando el SW nuevo terminó de instalar pero espera a que le
        // digamos SKIP_WAITING, mostramos el banner.
        reg.addEventListener("updatefound", () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          setSwEstado("checking");
          nuevo.addEventListener("statechange", () => {
            if (nuevo.state === "installed") {
              if (navigator.serviceWorker.controller) {
                // Hay un SW viejo controlando: hay una versión nueva
                setHayUpdate(true);
                setSwEstado("update-available");
              } else {
                // Primera instalación: ya está activo, no necesita banner
                setSwEstado("up-to-date");
              }
            }
          });
        });

        // Si ya hay un SW esperando (caso de F5 antes de actualizar),
        // mostramos el banner también.
        if (reg.waiting) {
          setHayUpdate(true);
          setSwEstado("update-available");
        }
      }).catch(() => {});

      // Cuando el SW nuevo toma el control tras Actualizar, recargamos
      // UNA sola vez para que la app arranque con la versión nueva.
      let recargando = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (recargando) return;
        recargando = true;
        window.location.reload();
      });
    }

    // Listen for install prompt
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setTimeout(() => setShowInstall(true), 3000);
    };
    window.addEventListener("beforeinstallprompt", handler);

    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setShowInstall(false);
      setInstallPrompt(null);
    });

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    setIsOffline(!navigator.onLine);
    const onOffline = () => setIsOffline(true);
    const onOnline = () => setIsOffline(false);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstall(false);
      setInstallPrompt(null);
    }
  }

  async function handleUpdate() {
    // Pedimos al SW nuevo que tome el control. Cuando lo haga, el
    // listener controllerchange recarga la página automáticamente.
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }

  /* ── Novedades: cuando hay versión nueva, mostramos QUÉ cambió y
     avisamos con una notificación (si el usuario las tiene activas).
     Un toque en "Actualizar ahora" y listo: nada de reinstalar. ── */
  const [novedades, setNovedades] = useState(null);
  const [showNovedades, setShowNovedades] = useState(false);
  useEffect(() => {
    if (!hayUpdate) return;
    fetch("/novedades.json?v=" + Date.now())
      .then(r => r.json())
      .then(d => { setNovedades(d); setShowNovedades(true); })
      .catch(() => {});
    /* AVISO AUTOMÁTICO A TODOS: el primer dispositivo que detecta la
       versión nueva le pide al servidor mandar el push a todos los
       suscritos. El servidor deduplica por build: sale una sola vez. */
    fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avisar_version: true }),
    }).catch(() => {});
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("AURA se actualizó 🎉", {
          body: "Hay una versión nueva lista. Abrí la app y tocá Actualizar.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        });
      }
    } catch {}
  }, [hayUpdate]);

  return (
    <>
      {/* ── Modal de NOVEDADES: qué trae la versión nueva ── */}
      {showNovedades && hayUpdate && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"var(--panel, #1a1a2e)",border:"1px solid var(--border, #2a2a3e)",borderRadius:18,padding:24,width:"100%",maxWidth:420,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,0.6)"}}>
            <div style={{fontSize:"1.15em",fontWeight:800,color:"var(--text, #e0e0e0)",marginBottom:4}}>{novedades?.titulo || "🎉 Versión nueva de AURA"}</div>
            {novedades?.version && <div style={{color:"var(--text4, #666)",fontSize:"0.75em",marginBottom:14}}>{novedades.version}</div>}
            <div style={{marginBottom:18}}>
              {(novedades?.cambios || ["Mejoras y correcciones"]).map((c, i) => (
                <div key={i} style={{display:"flex",gap:9,alignItems:"flex-start",padding:"6px 0",color:"var(--text2, #ccc)",fontSize:"0.88em",lineHeight:1.45}}>
                  <span style={{color:"#22c55e",fontWeight:800,flexShrink:0}}>✓</span> {c}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={handleUpdate} style={{flex:1,padding:"13px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",fontWeight:800,fontSize:"0.95em",cursor:"pointer",boxShadow:"0 6px 20px rgba(34,197,94,0.35)"}}>
                Actualizar ahora
              </button>
              <button onClick={()=>setShowNovedades(false)} style={{padding:"13px 16px",borderRadius:12,border:"1px solid var(--border, #2a2a3e)",background:"transparent",color:"var(--text3, #888)",fontWeight:700,fontSize:"0.9em",cursor:"pointer"}}>
                Después
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Banner de actualización: aparece arriba cuando hay versión nueva.
            El SW espera nuestro OK para tomar el control, así el usuario
            decide cuándo actualizar. ── */}
      {hayUpdate && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
          paddingTop: "env(safe-area-inset-top)",
          background: "linear-gradient(135deg,#22c55e,#16a34a)",
          color: "var(--text-strong)", boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 14, padding: "12px 16px", fontSize: "0.9em", fontWeight: 600,
            flexWrap: "wrap",
          }}>
            <IcUpdate size={20} />
            <span>Hay una versión nueva de AURA</span>
            <button
              onClick={handleUpdate}
              style={{
                background: "rgba(255,255,255,0.25)", border: "none", color: "var(--text-strong)",
                padding: "8px 18px", borderRadius: 8, fontWeight: 700,
                cursor: "pointer", fontSize: "0.95em", whiteSpace: "nowrap",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.4)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.25)"}
            >
              Actualizar
            </button>
            <button
              onClick={() => setHayUpdate(false)}
              title="Más tarde"
              style={{
                background: "transparent", border: "none", color: "rgba(255,255,255,0.7)",
                cursor: "pointer", fontSize: "1.3em", padding: "0 4px", lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Banner offline ── */}
      {isOffline && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
          background: "linear-gradient(135deg, var(--accent), #5a3fd6)",
          color: "var(--text-strong)", padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: "0.85em", fontWeight: 600,
          boxShadow: "0 -4px 20px rgba(124,92,252,0.3)",
        }}>
          <IcWifi size={18} />
          Sin conexión — Viendo datos guardados
        </div>
      )}

      {/* ── Banner de instalación ── */}
      {showInstall && !isInstalled && (
        <div style={{
          position: "fixed", bottom: isOffline ? 44 : 0, left: 0, right: 0, zIndex: 199,
          background: "var(--panel)", borderTop: "2px solid var(--accent)",
          padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent), #1ed760)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <IcMusic size={22} stroke="#fff" strokeWidth="2.2" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "var(--text)", fontSize: "0.9em", fontWeight: 600 }}>Instalar AURA</div>
            <div style={{ color: "var(--text3)", fontSize: "0.75em" }}>Funciona sin internet como una app</div>
          </div>
          <button onClick={handleInstall} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "var(--accent)", color: "#fff", fontSize: "0.85em",
            cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap",
          }}>Instalar</button>
          <button onClick={() => setShowInstall(false)} style={{
            background: "none", border: "none", color: "var(--text5)",
            cursor: "pointer", fontSize: "1.4em", padding: 0, lineHeight: 1,
          }}>×</button>
        </div>
      )}
    </>
  );
}
