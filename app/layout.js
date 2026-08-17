import { UserProvider } from "./components/UserContext";
import AuthGate from "./components/AuthGate";
import Navbar from "./components/Navbar";
import PWASetup from "./components/PWASetup";

export const metadata = {
  title: "🎵 Música Libre — Descargá portadas y creá playlists",
  description: "Buscá álbumes, descargá portadas en alta calidad, guardá favoritos y creá playlists — sin cuenta Premium",
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Música Libre",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#7c5cfc" />
      </head>
      <body style={{ margin: 0, background: "#0f0f1a", color: "#e0e0e0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        <UserProvider>
          <AuthGate>
            <Navbar>
              {children}
            </Navbar>
          </AuthGate>
        </UserProvider>
        <PWASetup />
      </body>
    </html>
  );
}
