import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   API /api/mirror — Versión mejorada
   
   Recibe: { url: "https://pagina.com" }
   Devuelve: { resources, source_url, title, error? }
   ═══════════════════════════════════════════════════ */

const FILE_EXTS = new Set([
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".mp4", ".mp3", ".wav", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dmg", ".iso", ".epub", ".mobi", ".flac",
  ".ogg", ".wma", ".apk", ".svg", ".webp",
  ".gif", ".png", ".jpg", ".jpeg", ".bmp", ".ico", ".tiff",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".css", ".js", ".py", ".java", ".cpp", ".c", ".rb",
  ".txt", ".csv", ".json", ".xml", ".html", ".md",
  ".psd", ".ai", ".sketch", ".fig",
]);

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff",
]);

function filenameFromUrl(url, rtype) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname).split("/").pop();
    if (!name || !name.includes(".")) {
      name = rtype === "image" ? `image_${Math.abs(hashCode(url)) % 10000}.jpg` : `file_${Math.abs(hashCode(url)) % 10000}`;
    }
    // Limpiar caracteres raros
    name = name.replace(/[^\w.\-]/g, "_").substring(0, 80);
    return name;
  } catch {
    return rtype === "image" ? "image.jpg" : "file";
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const url = body.url;
    if (!url) return NextResponse.json({ error: "URL vacía" }, { status: 400 });

    // Validar URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!parsedUrl.protocol.startsWith("http")) {
        return NextResponse.json({ error: "Solo se permiten URLs http/https" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL inválida. Ejemplo: https://ejemplo.com" }, { status: 400 });
    }

    // Fetch la página con headers de navegador real
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000), // 20s timeout
    });

    if (!resp.ok) {
      return NextResponse.json({
        error: `El sitio respondió con error ${resp.status}. Muchos sitios bloquean peticiones de servidores.`,
      }, { status: 400 });
    }

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || url;
    const resources = [];
    const seen = new Set();

    function addResource(fullUrl, rtype) {
      try {
        const u = new URL(fullUrl);
        // Ignorar data URIs, javascript:, mailto:
        if (!u.protocol.startsWith("http")) return;
        // Ignorar URLs muy largas
        if (fullUrl.length > 500) return;
        // Deduplicar
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);
        resources.push({
          url: fullUrl,
          filename: filenameFromUrl(fullUrl, rtype),
          type: rtype,
        });
      } catch {}
    }

    let pageTitle = "";

    if (contentType.includes("text/html") || contentType.includes("text/xhtml")) {
      const html = await resp.text();

      // Extraer título
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) pageTitle = titleMatch[1].trim();

      // ── <img> ──
      // src, data-src, data-lazy-src, data-original, data-zoom-image
      const imgAttrs = /<img[^>]+(?:src|data-src|data-lazy-src|data-original|data-zoom-image|data-lazy|data-image)\s*=\s*["']([^"']+)["']/gi;
      for (const m of html.matchAll(imgAttrs)) {
        if (m[1] && !m[1].startsWith("data:")) {
          try { addResource(new URL(m[1], finalUrl).href, "image"); } catch {}
        }
      }

      // ── <picture><source> ──
      const srcsetAttrs = /<(?:source|img)[^>]+srcset\s*=\s*["']([^"']+)["']/gi;
      for (const m of html.matchAll(srcsetAttrs)) {
        if (m[1]) {
          // srcset puede tener múltiples URLs: "img1.jpg 1x, img2.jpg 2x"
          const urls = m[1].split(",");
          for (const u of urls) {
            const clean = u.trim().split(/\s+/)[0]; // Quitar descriptor
            if (clean && !clean.startsWith("data:")) {
              try { addResource(new URL(clean, finalUrl).href, "image"); } catch {}
            }
          }
        }
      }

      // ── <a href="archivo.ext"> ──
      const hrefs = html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["']/gi);
      for (const m of hrefs) {
        try {
          const full = new URL(m[1], finalUrl).href;
          const u = new URL(full);
          const lastDot = u.pathname.lastIndexOf(".");
          if (lastDot > -1) {
            const ext = u.pathname.substring(lastDot).toLowerCase();
            if (FILE_EXTS.has(ext)) {
              const rtype = IMAGE_EXTS.has(ext) ? "image" : "file";
              addResource(full, rtype);
            }
          }
        } catch {}
      }

      // ── <source src="..."> ── (video/audio)
      const sources = html.matchAll(/<source[^>]+src\s*=\s*["']([^"']+)["']/gi);
      for (const m of sources) {
        if (m[1] && !m[1].startsWith("data:")) {
          try { addResource(new URL(m[1], finalUrl).href, "file"); } catch {}
        }
      }

      // ── <video poster="..."> ──
      const videoPosters = html.matchAll(/<video[^>]+poster\s*=\s*["']([^"']+)["']/gi);
      for (const m of videoPosters) {
        if (m[1]) {
          try { addResource(new URL(m[1], finalUrl).href, "image"); } catch {}
        }
      }

      // ── CSS background-image: url(...) ──
      const bgUrls = html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi);
      for (const m of bgUrls) {
        if (m[1] && !m[1].startsWith("data:") && !m[1].startsWith("#")) {
          try {
            const full = new URL(m[1], finalUrl).href;
            const u = new URL(full);
            const lastDot = u.pathname.lastIndexOf(".");
            if (lastDot > -1) {
              const ext = u.pathname.substring(lastDot).toLowerCase();
              if (IMAGE_EXTS.has(ext)) addResource(full, "image");
              else if (FILE_EXTS.has(ext)) addResource(full, "file");
            }
          } catch {}
        }
      }

      // ── <link rel="icon" href="..."> (favicons) ──
      const icons = html.matchAll(/<link[^>]+rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href\s*=\s*["']([^"']+)["']/gi);
      for (const m of icons) {
        if (m[1]) {
          try { addResource(new URL(m[1], finalUrl).href, "image"); } catch {}
        }
      }

      // ── <meta property="og:image" content="..."> ──
      const ogImages = html.matchAll(/<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/gi);
      for (const m of ogImages) {
        if (m[1]) {
          try { addResource(new URL(m[1], finalUrl).href, "image"); } catch {}
        }
      }

    } else if (contentType.startsWith("image/")) {
      // Es una imagen directa
      addResource(url, "image");
    } else {
      // Es un archivo directo
      addResource(url, "file");
    }

    return NextResponse.json({
      resources,
      source_url: finalUrl,
      title: pageTitle,
    });
  } catch (e) {
    // Mensajes de error más amigables
    let errorMsg = e.message;
    if (errorMsg.includes("fetch failed")) errorMsg = "No se pudo conectar al sitio. Puede estar caído o bloquear peticiones de servidores.";
    if (errorMsg.includes("timeout") || errorMsg.includes("TimeoutError")) errorMsg = "El sitio tardó demasiado en responder (timeout).";
    if (errorMsg.includes("ENOTFOUND")) errorMsg = "El dominio no existe o no se pudo resolver.";
    if (errorMsg.includes("ECONNREFUSED")) errorMsg = "El servidor rechazó la conexión.";

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
