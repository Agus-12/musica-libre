import { UserProvider } from "./components/UserContext";
import { ToastProvider } from "./components/ToastContext";
import { DownloadProvider } from "./components/DownloadManager";
import AuthGate from "./components/AuthGate";
import Navbar from "./components/Navbar";
import PWASetup from "./components/PWASetup";</parameter>
</invoke>


export const metadata = {
  title: "AURA — Tu música, siempre contigo",
  description: "Busca álbumes, descarga canciones y escucha sin conexión — gratis",
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black",
    "apple-mobile-web-app-title": "AURA",
  },
};

/* Sin `viewportFit: "cover"` los env(safe-area-inset-*) valen 0 en el celu,
   y la mini-barra queda tapada por la barra de gestos. */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a14",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon-64.png" sizes="64x64" />
      </head>
      <body style={{ margin: 0, background: "#0a0a14", color: "#e0e0e0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        <UserProvider>
          <DownloadProvider>
            <ToastProvider>
              <AuthGate>
                <Navbar>
                  {children}
                </Navbar>
              </AuthGate>
            </ToastProvider>
          </DownloadProvider>
        </UserProvider>
        <PWASetup />
      </body>
    </html>
  );
}
