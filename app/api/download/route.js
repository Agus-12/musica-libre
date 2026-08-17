import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/download
   
   Recibe: ?url=https://ejemplo.com/archivo.zip&filename=archivo.zip
   Hace:   Fetch el archivo y lo devuelve como descarga al navegador
   Para:   Botón "Descargar" — el navegador guarda el archivo
   ═══════════════════════════════════════════════════ */

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") || "download";

  if (!url) return new NextResponse("URL vacía", { status: 400 });

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new NextResponse(`Download error: ${e.message}`, { status: 500 });
  }
}
