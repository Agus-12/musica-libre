import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/mirror
   
   Recibe: { url: "https://pagina.com" }
   Hace:   Fetch la página, parsea HTML, busca <img>, <a>, <source>
   Devuelve: { resources: [{ url, filename, type }, ...], source_url }
   ═══════════════════════════════════════════════════ */

const FILE_EXTS = new Set([
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".mp4", ".mp3", ".wav", ".avi", ".mkv", ".mov",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dmg", ".iso", ".epub", ".mobi", ".flac",
  ".ogg", ".wma", ".wmv", ".apk", ".svg", ".webp",
  ".gif", ".png", ".jpg", ".jpeg", ".bmp", ".ico",
  ".woff", ".woff2", ".ttf",
]);

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico",
]);

function filenameFromUrl(url, rtype) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname).split("/").pop();
    if (!name || !name.includes(".")) {
      name = rtype === "image" ? `image_${Date.now() % 10000}.jpg` : `file_${Date.now() % 10000}`;
    }
    return name.replace(/[^\w.\-]/g, "_").substring(0, 80);
  } catch {
    return rtype === "image" ? "image.jpg" : "file";
  }
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL vacía" }, { status: 400 });

    // Fetch la página
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `Error ${resp.status}: ${resp.statusText}` }, { status: 400 });
    }

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || url;
    const resources = [];
    const seen = new Set();

    function addResource(fullUrl, rtype) {
      if (!fullUrl.startsWith("http")) return;
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      resources.push({
        url: fullUrl,
        filename: filenameFromUrl(fullUrl, rtype),
        type: rtype,
      });
    }

    if (contentType.includes("text/html")) {
      const html = await resp.text();
      // Parsear HTML con regex (ligero, sin dependencias extra en serverless)
      
      // <img src="...">
      const imgSrcs = html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/gi);
      for (const m of imgSrcs) {
        const full = new URL(m[1], finalUrl).href;
        addResource(full, "image");
      }

      // <a href="archivo.ext">
      const hrefs = html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["']/gi);
      for (const m of hrefs) {
        try {
          const full = new URL(m[1], finalUrl).href;
          const u = new URL(full);
          const ext = u.pathname.substring(u.pathname.lastIndexOf(".")).toLowerCase();
          if (FILE_EXTS.has(ext)) {
            const rtype = IMAGE_EXTS.has(ext) ? "image" : "file";
            addResource(full, rtype);
          }
        } catch {}
      }

      // <source src="...">
      const sources = html.matchAll(/<source[^>]+src\s*=\s*["']([^"']+)["']/gi);
      for (const m of sources) {
        const full = new URL(m[1], finalUrl).href;
        addResource(full, "file");
      }

      // CSS background-image: url(...)
      const bgUrls = html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi);
      for (const m of bgUrls) {
        try {
          if (m[1].startsWith("data:")) continue;
          const full = new URL(m[1], finalUrl).href;
          const u = new URL(full);
          const ext = u.pathname.substring(u.pathname.lastIndexOf(".")).toLowerCase();
          if (IMAGE_EXTS.has(ext)) addResource(full, "image");
        } catch {}
      }
    } else {
      // No es HTML, es un archivo directo
      addResource(url, "file");
    }

    return NextResponse.json({ resources, source_url: finalUrl });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
