"use client";
import { UserProvider } from "./UserContext";
import { ToastProvider } from "./ToastContext";
import { DownloadProvider } from "./DownloadManager";
import AuthGate from "./AuthGate";
import Navbar from "./Navbar";

/* Wrapper que envuelve todas las providers y componentes que necesitan
   estado React (client-side). Se importa desde layout.js como un solo
   Client Component, evitando que layout.js (Server Component) tenga que
   procesar Providers con value que contiene funciones, lo cual rompe el
   prerender estático de Next.js ("Unsupported Server Component type: Module"). */
export default function Providers({ children }) {
  return (
    <UserProvider>
      <DownloadProvider>
        <ToastProvider>
          <AuthGate>
            <Navbar>{children}</Navbar>
          </AuthGate>
        </ToastProvider>
      </DownloadProvider>
    </UserProvider>
  );
}
