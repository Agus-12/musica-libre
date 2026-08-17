/* Logotipo AURA en SVG.

   Las proporciones salen de medir el PNG original:
   4 letras de ~20.7% del ancho cada una, cuerpo desde el 30% de la
   altura (el macrón de la Ā ocupa el tramo de arriba) y trazo de
   ~10 unidades sobre un ancho de 302.

   viewBox 0 0 302 100 → mismo ratio 3.01 que el logo real. */
export default function LogoAura({ height = 26, color = "#e8e8ef", className, style }) {
  const w = Math.round(height * 3.01);
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 302 100"
      fill="none"
      role="img"
      aria-label="AURA"
      className={className}
      style={{ display: "block", ...style }}
    >
      {/* Macrón sobre la primera A */}
      <rect x="16" y="0" width="41" height="10" fill={color} />

      {/* A sin travesaño (dos trazos en pico) */}
      <path d="M2 100 L36.5 30 L71 100" stroke={color} strokeWidth="10" fill="none" />

      {/* U: dos verticales + semicírculo abajo */}
      <path
        d="M79 30 L79 68 A26 26 0 0 0 131 68 L131 30"
        stroke={color}
        strokeWidth="10"
        fill="none"
      />

      {/* R: vertical, cuenco superior y pata diagonal */}
      <path
        d="M167 100 L167 30 L199 30 A21 21 0 0 1 199 72 L167 72"
        stroke={color}
        strokeWidth="10"
        fill="none"
      />
      <path d="M197 72 L225 100" stroke={color} strokeWidth="10" fill="none" />

      {/* A final */}
      <path d="M239 100 L270.5 30 L302 100" stroke={color} strokeWidth="10" fill="none" />
    </svg>
  );
}
