"use client";
import { useState, createContext, useContext, useCallback, useRef } from "react";

const ToastContext = createContext(null);

let toastId = 0;

/* Iconos SVG para los toasts — mismo trazo de línea que el resto de la app
   (24x24, stroke=2.2). Sin emojis, todo armonioso con la estética. */
function ToastIcon({ type }) {
  const common = {
    width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 2.2,
    strokeLinecap: "round", strokeLinejoin: "round",
    style: { flexShrink: 0 },
  };
  if (type === "success") {
    return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>;
  }
  if (type === "error") {
    return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
  }
  if (type === "warning") {
    return <svg {...common}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  }
  if (type === "download") {
    return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
  }
  // info (default)
  return <svg {...common}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const addToast = useCallback((message, type = "success", duration = 5000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type, entering: true }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, entering: false } : t));
    }, 400);
    timersRef.current[id] = setTimeout(() => { dismissToast(id); }, duration);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      delete timersRef.current[id];
    }, 400);
  }, []);

  const clearToast = useCallback((id) => {
    if (timersRef.current[id]) { clearTimeout(timersRef.current[id]); delete timersRef.current[id]; }
    dismissToast(id);
  }, []);

  const toast = {
    success: (msg, dur) => addToast(msg, "success", dur),
    info: (msg, dur) => addToast(msg, "info", dur),
    warning: (msg, dur) => addToast(msg, "warning", dur),
    error: (msg, dur) => addToast(msg, "error", dur),
    download: (msg, dur) => addToast(msg, "download", dur),
    dismiss: clearToast,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={{
        position: "fixed",
        top: 70,
        right: 12,
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        pointerEvents: "none",
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => clearToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const { message, type, entering, exiting } = toast;

  const colors = {
    success: { bg: "rgba(34,197,94,0.95)", border: "#22c55e", glow: "rgba(34,197,94,0.3)" },
    info: { bg: "rgba(124,92,252,0.95)", border: "var(--accent)", glow: "rgba(124,92,252,0.3)" },
    warning: { bg: "rgba(234,179,8,0.95)", border: "#eab308", glow: "rgba(234,179,8,0.3)" },
    error: { bg: "rgba(239,68,68,0.95)", border: "#ef4444", glow: "rgba(239,68,68,0.3)" },
    download: { bg: "rgba(30,215,96,0.95)", border: "#1ed760", glow: "rgba(30,215,96,0.3)" },
  };
  const c = colors[type] || colors.info;

  return (
    <div
      onClick={onDismiss}
      style={{
        background: c.bg,
        color: "var(--text-strong)",
        padding: "12px 16px",
        borderRadius: 12,
        boxShadow: `0 8px 28px ${c.glow}, 0 2px 8px rgba(0,0,0,0.4)`,
        border: `1px solid ${c.border}`,
        fontSize: "0.9em",
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        pointerEvents: "auto",
        transform: exiting ? "translateX(120%)" : entering ? "translateX(120%)" : "translateX(0)",
        opacity: exiting ? 0 : entering ? 0 : 1,
        transition: "transform 0.4s cubic-bezier(0.32,0.72,0,1), opacity 0.4s",
        maxWidth: 340,
      }}
    >
      <ToastIcon type={type} />
      <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
