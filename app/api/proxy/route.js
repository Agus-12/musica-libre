import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/proxy — Versión mejorada
   
   Proxy para mostrar imágenes del espejo (evita CORS)
   ═══════════════════════════════════════════════════ */

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("URL vacía", { status: 400 });

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": new URL(url).origin + "/",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      // Devolver imagen placeholder en vez de error
      const placeholder = createPlaceholderSvg(resp.status);
      return new NextResponse(placeholder, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
      });
    }

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const body = await resp.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    // Devolver placeholder en vez de error
    const placeholder = createPlaceholderSvg("?");
    return new NextResponse(placeholder, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
    });
  }
}

function createPlaceholderSvg(status) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
    <rect fill="var(--panel)" width="300" height="180"/>
    <text fill="var(--text5)" font-family="sans-serif" font-size="14" x="150" y="80" text-anchor="middle">🚫 No se pudo cargar</text>
    <text fill="var(--text6)" font-family="sans-serif" font-size="11" x="150" y="105" text-anchor="middle">Error ${status}</text>
  </svg>`;
  return svg;
}
