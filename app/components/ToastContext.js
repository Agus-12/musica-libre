"use client";
import { useState, createContext, useContext, useCallback, useRef } from "react";

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const addToast = useCallback((message, type = "success", duration = 5000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type, entering: true }]);
    // Remove entering animation after it completes
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, entering: false } : t));
    }, 400);
    // Auto-dismiss
    timersRef.current[id] = setTimeout(() => {
      dismissToast(id);
    }, duration);
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
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    dismissToast(id);
  }, []);

  // Convenience methods
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
      {/* Toast container - right side of screen */}
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
  const { id, message, type, entering, exiting } = toast;

  const colors = {
    success: { bg: "rgba(34,197,94,0.95)", border: "#22c55e", icon: "✅", glow: "rgba(34,197,94,0.3)" },
    info: { bg: "rgba(59,130,246,0.95)", border: "#3b82f6", icon: "ℹ️", glow: "rgba(59,130,246,0.3)" },
    warning: { bg: "rgba(234,179,8,0.95)", border: "#eab308", icon: "⚠️", glow: "rgba(234,179,8,0.3)" },
    error: { bg: "rgba(239,68,68,0.95)", border: "#ef4444", icon: "❌", glow: "rgba(239,68,68,0.3)" },
    download: { bg: "rgba(124,92,252,0.95)", border: "#7c5cfc", icon: "⬇️", glow: "rgba(124,92,252,0.3)" },
  };

  const c = colors[type] || colors.success;
  const animClass = entering ? "toast-enter" : exiting ? "toast-exit" : "";

  return (
    <div
      className={animClass}
      onClick={onDismiss}
      style={{
        background: c.bg,
        color: "#fff",
        padding: "12px 16px 12px 12px",
        borderRadius: 12,
        fontSize: "0.85em",
        fontWeight: 600,
        boxShadow: `0 4px 24px ${c.glow}, 0 0 0 1px ${c.border}44`,
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        pointerEvents: "auto",
        lineHeight: 1.4,
        backdropFilter: "blur(8px)",
        animation: entering
          ? "toastSlideIn 0.35s cubic-bezier(0.21,1.02,0.73,1) forwards"
          : exiting
          ? "toastSlideOut 0.3s ease-in forwards"
          : "none",
      }}
    >
      <span style={{ fontSize: "1.1em", flexShrink: 0, lineHeight: 1 }}>{c.icon}</span>
      <span style={{ flex: 1 }}>{message}</span>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Global toast styles injected once
if (typeof document !== "undefined" && !document.getElementById("toast-styles")) {
  const style = document.createElement("style");
  style.id = "toast-styles";
  style.textContent = `
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translateX(80px) scale(0.9); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes toastSlideOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(80px) scale(0.9); }
    }
  `;
  document.head.appendChild(style);
}
