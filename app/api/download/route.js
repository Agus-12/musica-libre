import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/download — Versión mejorada
   
   Descarga un archivo y lo devuelve al navegador
   ═══════════════════════════════════════════════════ */

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") || "download";

  if (!url) return new NextResponse("URL vacía", { status: 400 });

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": new URL(url).origin + "/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return new NextResponse(
        JSON.stringify({ error: `Error ${resp.status} al descargar` }),
        { status: resp.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const body = await resp.arrayBuffer();

    // Limpiar filename para header
    const safeName = filename.replace(/[^\w.\-]/g, "_");

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new NextResponse(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
