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

function yaEstaInstalada() {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    if (window.navigator.standalone === true) return true;
  } catch {}
  return false;
}
function esIosSafari() {
  const ua = String(navigator.userAgent || "");
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS;
}
function instalacionPospuesta() {
  try {
    const t = Number(localStorage.getItem("aura_instalar_no") || 0);
    return t > Date.now();
  } catch { return false; }
}

export default function PWASetup() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [iosPasos, setIosPasos] = useState(false);
  const [esIOS, setEsIOS] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hayUpdate, setHayUpdate] = useState(false);
  const [swEstado, setSwEstado] = useState("checking"); // checking | up-to-date | update-available
  const cleanupRef = useRef(null);
  const installPromptRef = useRef(null);

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
    const ev = installPromptRef.current || installPrompt;
    if (ev && ev.prompt) {
      try {
        ev.prompt();
        const { outcome } = await ev.userChoice;
        if (outcome === "accepted") {
          setShowInstall(false);
          setInstallPrompt(null);
          installPromptRef.current = null;
          return;
        }
      } catch {}
    }
    // iOS (y Android sin API): no se puede clavar el ícono por código.
    // Mostramos los 2 toques que pide el sistema.
    setIosPasos(true);
  }
  function posponerInstalar() {
    try { localStorage.setItem("aura_instalar_no", String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch {}
    setShowInstall(false);
    setIosPasos(false);
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

  /* ── Modo sin datos CONSCIENTE ──────────────────────────────────
     Si está activo pero detectamos internet (ping de <1 KB al abrir
     la app o volver a ella), avisamos: nadie se queda "atrapado" en
     modo offline por olvidarlo encendido. */
  const [avisoDatos, setAvisoDatos] = useState(false);
  const [avisoSinRed, setAvisoSinRed] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  useEffect(() => {
    const h = (e) => setPlayerVisible(Boolean(e.detail && e.detail.key));
    window.addEventListener("aura-sonando", h);
    return () => window.removeEventListener("aura-sonando", h);
  }, []);
  useEffect(() => {
    let ultimoPing = 0;
    const revisar = async () => {
      try {
        const activo = localStorage.getItem("aura_sin_datos") === "1";
        if (Date.now() - ultimoPing < 60000) return;
        ultimoPing = Date.now();
        if (activo) {
          /* Modo activo: ¿hay internet? → ofrecer salir */
          setAvisoSinRed(false);
          if (sessionStorage.getItem("aura_ping_snooze") === "1") return;
          const r = await fetch("/manifest.json?aura-ping=" + Date.now(), { cache: "no-store", signal: AbortSignal.timeout(4000) });
          if (r.ok) setAvisoDatos(true);
        } else {
          /* Modo apagado: ¿NO hay internet? → ofrecer activarlo */
          setAvisoDatos(false);
          if (sessionStorage.getItem("aura_ping_snooze_off") === "1") return;
          try {
            const r = await fetch("/manifest.json?aura-ping=" + Date.now(), { cache: "no-store", signal: AbortSignal.timeout(4000) });
            if (!r.ok) throw new Error("sin red");
            setAvisoSinRed(false);
          } catch {
            setAvisoSinRed(true);
          }
        }
      } catch {}
    };
    const alVolver = () => { if (document.visibilityState === "visible") revisar(); };
    setTimeout(revisar, 2500);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("aura-sin-datos", (e) => { if (!e.detail) setAvisoDatos(false); else setTimeout(revisar, 1500); });
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, []);
  async function salirDeSinDatos() {
    try {
      localStorage.setItem("aura_sin_datos", "");
      const c = await caches.open("ml-config");
      await c.delete("modo-sin-datos");
      window.dispatchEvent(new CustomEvent("aura-sin-datos", { detail: false }));
    } catch {}
    setAvisoDatos(false);
    window.location.reload();
  }
  function seguirSinDatos() {
    try { sessionStorage.setItem("aura_ping_snooze", "1"); } catch {}
    setAvisoDatos(false);
  }
  async function activarSinDatosDesdeAviso() {
    try {
      localStorage.setItem("aura_sin_datos", "1");
      const c = await caches.open("ml-config");
      await c.put("modo-sin-datos", new Response("1"));
      window.dispatchEvent(new CustomEvent("aura-sin-datos", { detail: true }));
    } catch {}
    setAvisoSinRed(false);
    window.location.reload();
  }
  function posponerSinRed() {
    try { sessionStorage.setItem("aura_ping_snooze_off", "1"); } catch {}
    setAvisoSinRed(false);
  }
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
      {/* ── Aviso: modo sin datos activo PERO hay internet ── */}
      {avisoDatos && (
        <div style={{ position: "fixed", bottom: playerVisible ? "calc(82px + env(safe-area-inset-bottom))" : 0, left: 0, right: 0, zIndex: 10500, padding: playerVisible ? "12px 16px 14px" : "12px 16px calc(14px + env(safe-area-inset-bottom))", background: "rgba(10,10,20,0.92)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(234,179,8,0.35)", borderBottom: playerVisible ? "1px solid rgba(234,179,8,0.35)" : "none" }}>
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            <div style={{ color: "#eab308", fontWeight: 800, fontSize: "0.88em", marginBottom: 4 }}>Hay internet disponible</div>
            <div style={{ color: "rgba(230,230,240,0.7)", fontSize: "0.78em", marginBottom: 10, lineHeight: 1.45 }}>El modo sin datos sigue activo. ¿Lo apagamos para usar la conexión?</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={salirDeSinDatos} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "#eab308", color: "#141414", fontWeight: 800, fontSize: "0.85em", cursor: "pointer" }}>Usar internet</button>
              <button onClick={seguirSinDatos} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(230,230,240,0.7)", fontWeight: 700, fontSize: "0.85em", cursor: "pointer" }}>Seguir sin datos</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Aviso: NO hay internet → ofrecer el modo sin datos ── */}
      {avisoSinRed && !avisoDatos && (
        <div style={{ position: "fixed", bottom: playerVisible ? "calc(82px + env(safe-area-inset-bottom))" : 0, left: 0, right: 0, zIndex: 10500, padding: playerVisible ? "12px 16px 14px" : "12px 16px calc(14px + env(safe-area-inset-bottom))", background: "rgba(10,10,20,0.92)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(234,179,8,0.35)", borderBottom: playerVisible ? "1px solid rgba(234,179,8,0.35)" : "none" }}>
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            <div style={{ color: "#eab308", fontWeight: 800, fontSize: "0.88em", marginBottom: 4 }}>Parece que no hay conexión</div>
            <div style={{ color: "rgba(230,230,240,0.7)", fontSize: "0.78em", marginBottom: 10, lineHeight: 1.45 }}>Activá el modo sin datos: la app va más fluida con tu música descargada y no gasta datos intentando conectar.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={activarSinDatosDesdeAviso} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "#eab308", color: "#141414", fontWeight: 800, fontSize: "0.85em", cursor: "pointer" }}>Activar modo sin datos</button>
              <button onClick={posponerSinRed} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(230,230,240,0.7)", fontWeight: 700, fontSize: "0.85em", cursor: "pointer" }}>Ahora no</button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Alerta: agregar AURA al inicio (navegador iOS/Android) ── */}
      {showInstall && !isInstalled && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50000, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0 }}>
          <div style={{ width: "100%", maxWidth: 460, background: "var(--panel, #161622)", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: "22px 20px calc(20px + env(safe-area-inset-bottom))", boxShadow: "0 -16px 50px rgba(0,0,0,0.45)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, overflow: "hidden", flexShrink: 0, background: "linear-gradient(135deg, var(--accent), #1ed760)" }}>
                <img src="/icon-192.png" alt="" width={48} height={48} style={{ display: "block", width: 48, height: 48 }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--text)", fontSize: "1.05em", fontWeight: 800 }}>Poné AURA en el inicio</div>
                <div style={{ color: "var(--text3)", fontSize: "0.78em", marginTop: 2 }}>Se abre como app, sin barra del navegador</div>
              </div>
            </div>

            {iosPasos ? (
              <div style={{ color: "var(--text2, #ccc)", fontSize: "0.86em", lineHeight: 1.5, marginBottom: 14 }}>
                {esIOS ? (
                  <>
                    Apple no deja ponerlo de un toque. En Safari:
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      <div><b style={{ color: "#fff" }}>1.</b> Tocá el botón <b style={{ color: "#fff" }}>Compartir</b> (el cuadrado con la flecha ↑ abajo en el centro).</div>
                      <div><b style={{ color: "#fff" }}>2.</b> Bajá y tocá <b style={{ color: "#fff" }}>Agregar a inicio</b>.</div>
                      <div><b style={{ color: "#fff" }}>3.</b> Tocá <b style={{ color: "#fff" }}>Agregar</b>.</div>
                    </div>
                  </>
                ) : (
                  <>
                    En el menú del navegador (⋮ o ⋯) tocá <b style={{ color: "#fff" }}>Instalar app</b> o <b style={{ color: "#fff" }}>Agregar a pantalla de inicio</b>.
                  </>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text3)", fontSize: "0.8em", lineHeight: 1.45, marginBottom: 14 }}>
                {esIOS
                  ? "Así la tenés en el inicio como las otras apps. En iPhone son 2 toques del sistema."
                  : "Al tocar el botón, el teléfono te pide confirmar y la deja en el inicio."}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              {!iosPasos && (
                <button onClick={handleInstall} style={{ flex: 1, padding: "13px 16px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", fontWeight: 800, fontSize: "0.95em", cursor: "pointer" }}>
                  Agregar al inicio
                </button>
              )}
              <button onClick={posponerInstalar} style={{ flex: iosPasos ? 1 : undefined, padding: "13px 16px", borderRadius: 12, border: "1px solid var(--border, #2a2a3e)", background: "transparent", color: "var(--text3, #888)", fontWeight: 700, fontSize: "0.9em", cursor: "pointer" }}>
                Ahora no
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
