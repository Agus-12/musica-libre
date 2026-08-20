import "./globals.css";
import Providers from "./components/Providers";
import PWASetup from "./components/PWASetup";

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
  /* iOS: sin esto, al enfocar un input Safari hace un zoom automático
     molesto. El usuario igual puede hacer pellizco manual (iOS ignora
     el tope para gestos propios). */
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "var(--bg)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon-64.png" sizes="64x64" />
        {/* Aplica tema/acento/fuente ANTES del primer pintado (sin parpadeo) */}
        <script dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement;if(localStorage.getItem("aura_tema")==="claro")d.classList.add("tema-claro");var a=localStorage.getItem("aura_accent");if(a)d.style.setProperty("--accent",a);var f=localStorage.getItem("aura_fuente");if(f)d.setAttribute("data-fuente",f);}catch(e){}` }} />
      </head>
      <body style={{ margin: 0, background: "var(--bg)", color: "var(--text)", fontFamily: "var(--fuente, 'Segoe UI', system-ui, sans-serif)" }}>
        <Providers>{children}</Providers>
        <PWASetup />
      </body>
    </html>
  );
}
