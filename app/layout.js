export const metadata = {
  title: "🪞 Espejo + Descargas",
  description: "Espejea cualquier página y descarga sus imágenes y archivos",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#0f0f1a", color: "#e0e0e0", fontFamily: "'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
