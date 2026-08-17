import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/proxy
   
   Recibe: ?url=https://ejemplo.com/imagen.jpg
   Hace:   Fetch la URL y devuelve el contenido tal cual
   Para:   Que las imágenes del espejo se muestren (evita CORS)
   ═══════════════════════════════════════════════════ */

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("URL vacía", { status: 400 });

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: url,
      },
      redirect: "follow",
    });

    if (!resp.ok) return new NextResponse(`Error ${resp.status}`, { status: resp.status });

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const body = await resp.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600", // Cachear 1 hora
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new NextResponse(`Proxy error: ${e.message}`, { status: 500 });
  }
}
