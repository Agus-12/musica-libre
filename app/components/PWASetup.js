"use client";
import { useState, useEffect, useRef } from "react";

export default function PWASetup() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hayUpdate, setHayUpdate] = useState(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    /* Registro del service worker + detección de actualizaciones.

       Sin esto, el SW nuevo se queda "esperando" y la app sigue
       mostrando la versión vieja hasta que cerrás todas las pestañas.
       Por eso los cambios parecían no llegar nunca al celular. */
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

        // Cuando hay una versión nueva lista, avisamos
        reg.addEventListener("updatefound", () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener("statechange", () => {
            if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
              setHayUpdate(true);
            }
          });
        });
      }).catch(() => {});

      // Cuando el SW nuevo toma el control, recargamos una sola vez
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
      // Show install banner after 3 seconds
      setTimeout(() => setShowInstall(true), 3000);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Check if already installed
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setShowInstall(false);
      setInstallPrompt(null);
    });

    // Check if standalone (already installed)
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Online/offline status
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

  return (
    <>
      {/* Aviso de versión nueva: aparece arriba, respetando el notch */}
      {hayUpdate && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
          paddingTop: "env(safe-area-inset-top)",
          background: "linear-gradient(135deg,#22c55e,#16a34a)",
          color: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 12, padding: "10px 16px", fontSize: "0.85em", fontWeight: 600,
          }}>
            <span>Hay una versión nueva de AURA</span>
            <button
              onClick={() => {
                // El SW nuevo ya está listo: le decimos que tome el control.
                navigator.serviceWorker.getRegistration().then(reg => {
                  if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
                  else window.location.reload();
                }).catch(() => window.location.reload());
              }}
              style={{
                background: "rgba(255,255,255,0.22)", border: "none", color: "#fff",
                padding: "7px 14px", borderRadius: 8, fontWeight: 700,
                cursor: "pointer", fontSize: "0.95em", whiteSpace: "nowrap",
              }}>
              Actualizar
            </button>
          </div>
        </div>
      )}

      {/* Offline banner */}
      {isOffline && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
          background: "linear-gradient(135deg, #7c5cfc, #5a3fd6)",
          color: "#fff", padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: "0.85em", fontWeight: 600,
          boxShadow: "0 -4px 20px rgba(124,92,252,0.3)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A13 13 0 0 1 16.9 9.45"/><path d="M8.46 4.28A16 16 0 0 1 19 13.72"/><line x1="2" y1="2" x2="22" y2="22"/>
          </svg>
          Sin conexión — Viendo datos guardados
        </div>
      )}

      {/* Install prompt */}
      {showInstall && !isInstalled && (
        <div style={{
          position: "fixed", bottom: isOffline ? 40 : 0, left: 0, right: 0, zIndex: 199,
          background: "#1a1a2e", borderTop: "2px solid #7c5cfc",
          padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #7c5cfc, #1ed760)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3em", flexShrink: 0 }}>🎵</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#e0e0e0", fontSize: "0.9em", fontWeight: 600 }}>Instalar AURA</div>
            <div style={{ color: "#888", fontSize: "0.75em" }}>Funciona sin internet como una app</div>
          </div>
          <button onClick={handleInstall} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#7c5cfc", color: "#fff", fontSize: "0.85em", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
            Instalar
          </button>
          <button onClick={() => setShowInstall(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "1.2em", padding: 0 }}>×</button>
        </div>
      )}
    </>
  );
}
