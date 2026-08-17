import { UserProvider } from "./components/UserContext";
import AuthGate from "./components/AuthGate";
import Navbar from "./components/Navbar";

export const metadata = {
  title: "🎵 Música Libre — Descargá portadas y creá playlists",
  description: "Buscá álbumes, descargá portadas en alta calidad, guardá favoritos y creá playlists — sin cuenta Premium",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#0f0f1a", color: "#e0e0e0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        <UserProvider>
          <AuthGate>
            <Navbar>
              {children}
            </Navbar>
          </AuthGate>
        </UserProvider>
      </body>
    </html>
  );
}
