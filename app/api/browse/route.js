import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   API /api/browse — PROXY WEB COMPLETO (v5 — SPA support)
   
   Dos modos:
   1. HTML estático → Proxy normal (reescribe URLs, inyecta toolbar)
   2. SPA/JavaScript (Spotify, Instagram, etc.) → Extrae recursos
      del HTML y muestra galería personalizada con descargas
   ═══════════════════════════════════════════════════════════════ */

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="122","Not(A:Brand";v="24","Google Chrome";v="122"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const IMAGE_EXTS = new Set([".jpg",".jpeg",".png",".gif",".webp",".svg",".bmp",".ico",".tiff",".tif",".avif"]);
const BINARY_EXTS = new Set([".pdf",".zip",".rar",".7z",".tar",".gz",".bz2",".mp4",".mp3",".wav",".avi",".mkv",".mov",".flv",".wmv",".webm",".m4a",".aac",".flac",".ogg",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".exe",".dmg",".iso",".apk",".epub",".mobi",".woff",".woff2",".ttf",".eot",".otf"]);

// Dominios que sabemos son SPAs
const SPA_DOMAINS = ["open.spotify.com","www.instagram.com","twitter.com","x.com","www.tiktok.com","vm.tiktok.com","www.facebook.com","m.facebook.com","www.netflix.com","music.apple.com","apps.apple.com","soundcloud.com","www.youtube.com","music.youtube.com","discord.com","t.me","web.telegram.org"];

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname).split("/").pop();
    if (!name || name.length < 2) name = `download_${Date.now() % 10000}`;
    return name.replace(/[^\w.\-]/g, "_").substring(0, 100);
  } catch { return "download"; }
}

function isImageExt(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    return dot > -1 && IMAGE_EXTS.has(path.substring(dot));
  } catch { return false; }
}

function isBinaryDownload(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    return dot > -1 && BINARY_EXTS.has(path.substring(dot));
  } catch { return false; }
}

function isSpa(url) {
  try {
    const hostname = new URL(url).hostname;
    return SPA_DOMAINS.some(d => hostname === d || hostname.endsWith("." + d));
  } catch { return false; }
}

export async function GET(req) {
  const targetUrl = req.nextUrl.searchParams.get("url");
  if (!targetUrl) return NextResponse.json({ error: "Falta ?url=" }, { status: 400 });
  try { new URL(targetUrl); } catch { return NextResponse.json({ error: "URL inválida" }, { status: 400 }); }

  try {
    // Build headers - add cookies for known SPA sites
    const reqHeaders = { ...BROWSER_HEADERS };
    try {
      const hostname = new URL(targetUrl).hostname;
      if (hostname.includes("spotify.com")) {
        reqHeaders["Cookie"] = "sp_t=a1b2c3d4e5f6g7h8; sp_ab=abc123";
        reqHeaders["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      }
    } catch {}

    const resp = await fetch(targetUrl, { headers: reqHeaders, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!resp.ok) return errorPage(resp.status);
    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;

    // ── No es HTML: servir directo ──
    if (!contentType.includes("text/html") && !contentType.includes("text/xhtml") && !contentType.includes("application/xhtml")) {
      const body = await resp.arrayBuffer();
      const headers = { "Content-Type": contentType || "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" };
      if (isBinaryDownload(targetUrl)) headers["Content-Disposition"] = `attachment; filename="${filenameFromUrl(targetUrl)}"`;
      return new NextResponse(body, { status: 200, headers });
    }

    // ── Es HTML ──
    let html = await resp.text();

    // Detectar si es SPA
    const spaDetected = isSpa(targetUrl) || detectSpaFromHtml(html);

    if (spaDetected) {
      // MODO SPA: extraer recursos y mostrar galería personalizada
      const resources = extractResources(html, finalUrl);
      const meta = extractMeta(html);
      return spaGalleryPage(targetUrl, finalUrl, resources, meta);
    }

    // MODO NORMAL: proxy con reescritura de URLs
    html = rewriteHtmlUrls(html, finalUrl);
    html = injectToolbar(html, finalUrl, targetUrl);
    return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    let msg = e.message;
    if (msg.includes("timeout")) msg = "El sitio tardó demasiado en responder";
    if (msg.includes("ENOTFOUND")) msg = "El dominio no existe";
    return errorPage(0, msg);
  }
}

/* ═══════════════════════════════════════════════════
   DETECCIÓN DE SPA
   ═══════════════════════════════════════════════════ */

function detectSpaFromHtml(html) {
  // Un SPA tiene muy poco contenido visible y mucho JavaScript
  const scriptTags = (html.match(/<script/gi) || []).length;
  const bodyContent = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || ["",""])[1];
  // Quitar scripts del body para medir contenido real
  const realContent = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
  // Si hay muchos scripts y muy poco contenido visible → SPA
  if (scriptTags > 5 && realContent.length < 200) return true;
  // Si tiene react/angular/vue root
  if (html.includes('id="root"') || html.includes('id="__next"') || html.includes('id="app"') || html.includes('ng-app') || html.includes('__NUXT')) return true;
  return false;
}

/* ═══════════════════════════════════════════════════
   EXTRACCIÓN DE RECURSOS
   ═══════════════════════════════════════════════════ */

// Known image CDN patterns (no file extension but serve images)
const IMAGE_CDNS = ["i.scdn.co", "i.imgur.com", "pbs.twimg.com", "cdninstagram.com", "scontent", "mosaic.scdn.co"];

function extractResources(html, baseUrl) {
  const resources = [];
  const seen = new Set();

  function add(url, type, label) {
    try {
      if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:")) return;
      let full;
      try { full = new URL(url, baseUrl).href; } catch { return; }
      if (!full.startsWith("http")) return;
      if (seen.has(full)) return;
      seen.add(full);
      let filename = filenameFromUrl(full);
      // For CDN URLs without extension, generate a name
      if (!filename.includes(".") || filename.startsWith("image_")) {
        const hash = Math.abs(full.split("/").pop().hashCode?.() || full.length) % 10000;
        if (type === "image") filename = `image_${hash}.jpg`;
        else filename = `file_${hash}`;
      }
      resources.push({ url: full, type, label: label || filename, filename });
    } catch {}
  }

  // 1. Meta images (og:image, twitter:image) — most important
  for (const m of html.matchAll(/content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["'](?:og:image|twitter:image)["']/gi)) add(m[1], "image", "Imagen principal");
  for (const m of html.matchAll(/property\s*=\s*["'](?:og:image|twitter:image)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) add(m[1], "image", "Imagen principal");

  // 2. <img> tags — ALL src and data-* attributes
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src|data-original|data-lazy|data-image)\s*=\s*["']([^"']+)["']/gi)) add(m[1], "image", "Imagen");

  // 3. Links to downloadable files
  for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const full = new URL(m[1], baseUrl).href;
      const path = new URL(full).pathname.toLowerCase();
      const dot = path.lastIndexOf(".");
      if (dot > -1) {
        const ext = path.substring(dot);
        if (IMAGE_EXTS.has(ext)) add(m[1], "image", "Imagen");
        else if (BINARY_EXTS.has(ext)) add(m[1], "file", "Archivo");
      }
    } catch {}
  }

  // 4. <source> tags (video/audio)
  for (const m of html.matchAll(/<source[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1], "media", "Media");

  // 5. CSS background-image: url()
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    if (m[1].startsWith("data:")) continue;
    try {
      const full = new URL(m[1], baseUrl).href;
      const u = new URL(full);
      const path = u.pathname.toLowerCase();
      const dot = path.lastIndexOf(".");
      if (dot > -1 && IMAGE_EXTS.has(path.substring(dot))) add(m[1], "image", "Fondo CSS");
      else if (IMAGE_CDNS.some(cdn => u.hostname.includes(cdn))) add(m[1], "image", "Imagen CDN");
    } catch {}
  }

  // 6. Favicon/icons
  for (const m of html.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["']/gi)) add(m[1], "image", "Favicon");

  // 7. AGGRESSIVE: Scan for ANY image URL pattern in the entire HTML
  //    This catches CDN URLs like i.scdn.co that don't appear in <img> tags properly
  const imgUrlPattern = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif|ico)(?:\?[^\s"'<>]*)?/gi;
  for (const m of html.matchAll(imgUrlPattern)) add(m[0], "image", "Imagen");

  // 8. AGGRESSIVE: Known image CDNs without extensions (Spotify, etc.)
  for (const cdn of IMAGE_CDNS) {
    const cdnPattern = new RegExp(`https?://[^\\s"'<>]*${cdn.replace(/\./g, "\\.")}/[^\\s"'<>]+`, "gi");
    for (const m of html.matchAll(cdnPattern)) {
      const url = m[0].replace(/[,;)\]}]+$/, ""); // Clean trailing chars
      if (url.length > 20 && url.length < 500) add(url, "image", "Imagen CDN");
    }
  }

  // 9. JSON-LD structured data (Spotify puts album info here)
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data.image) {
        if (typeof data.image === "string") add(data.image, "image", "Portada del álbum");
        else if (Array.isArray(data.image)) data.image.forEach(i => add(typeof i === "string" ? i : i.url, "image", "Portada"));
      }
      if (data.name) { /* metadata, handled elsewhere */ }
    } catch {}
  }

  return resources;
}

function extractMeta(html) {
  const meta = {};
  // og: tags
  for (const m of html.matchAll(/property\s*=\s*["']og:([^"']+)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) meta[m[1]] = m[2];
  for (const m of html.matchAll(/content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:([^"']+)["']/gi)) meta[m[2]] = m[1];
  // twitter: tags
  for (const m of html.matchAll(/name\s*=\s*["']twitter:([^"']+)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) { if (!meta[m[1]]) meta[m[1]] = m[2]; }
  // description
  for (const m of html.matchAll(/name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) { if (!meta.description) meta.description = m[1]; }
  // title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) meta.htmlTitle = titleMatch[1].trim();
  // JSON-LD structured data (Spotify albums, etc.)
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data.name && !meta.title) meta.title = data.name;
      if (data.description && !meta.description) meta.description = data.description;
      if (data.image && !meta.image) {
        meta.image = typeof data.image === "string" ? data.image : (Array.isArray(data.image) ? data.image[0] : data.image?.url) || "";
      }
      if (data.datePublished) meta.date = data.datePublished;
      if (data["@type"]) meta.type = data["@type"];
    } catch {}
  }
  // Prefer JSON-LD title over HTML title
  if (!meta.title) meta.title = meta.htmlTitle;
  return meta;
}

/* ═══════════════════════════════════════════════════
   PÁGINA GALERÍA SPA
   Cuando no podemos renderizar la página, mostramos
   todos los recursos extraídos en una galería bonita
   ═══════════════════════════════════════════════════ */

function spaGalleryPage(originalUrl, finalUrl, resources, meta) {
  const title = meta.title || meta["site_name"] || "Espejo";
  const description = meta.description || "";
  const ogImage = meta.image || "";

  const resourceCards = resources.map((r, i) => {
    const isImg = r.type === "image";
    const icon = { image: "🖼️", file: "📎", media: "🎬" }[r.type] || "📎";
    const proxyUrl = `/api/browse?url=${encodeURIComponent(r.url)}`;

    return `
      <div class="res-card">
        ${isImg ? `<img class="res-thumb" src="${proxyUrl}" alt="${r.filename}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="res-placeholder" style="display:none">${icon}</div>` : `<div class="res-placeholder">${icon}</div>`}
        <div class="res-info">
          <div class="res-name">${r.filename}</div>
          <div class="res-label">${r.label}</div>
          <div class="res-actions">
            <a class="btn-download" href="/api/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(r.filename)}" download>⬇️ Descargar</a>
            <a class="btn-open" href="${r.url}" target="_blank" rel="noopener">🔗 Original</a>
          </div>
        </div>
      </div>`;
  }).join("");

  const allDownloadUrl = resources
    .filter((r) => r.type === "image" || r.type === "file")
    .map((r) => `<url>${encodeURIComponent(r.url)}</url><fn>${encodeURIComponent(r.filename)}</fn>`)
    .join("|");

  return new NextResponse(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🪞 ${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0f0f1a;color:#e0e0e0;min-height:100vh}
.container{max-width:1000px;margin:0 auto;padding:20px}
.toolbar{position:sticky;top:0;z-index:9999;background:linear-gradient(135deg,#1a1a2e,#2a1a3e);border-bottom:2px solid #7c5cfc;padding:10px 15px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 20px rgba(0,0,0,0.5);margin:-20px -20px 20px;padding:10px 15px}
.toolbar .logo{font-weight:700;color:#7c5cfc;font-size:14px}
.toolbar .url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888;font-size:12px}
.toolbar a{padding:5px 12px;border-radius:6px;border:none;color:#fff;cursor:pointer;font-weight:600;font-size:12px;text-decoration:none;white-space:nowrap}
.meta-section{background:#1a1a2e;border-radius:12px;padding:20px;margin-bottom:25px;border:1px solid #2a2a3e;display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.meta-image{width:180px;height:180px;border-radius:10px;object-fit:cover;flex-shrink:0}
.meta-placeholder{width:180px;height:180px;border-radius:10px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);display:flex;align-items:center;justify-content:center;font-size:4em;flex-shrink:0}
.meta-text{flex:1;min-width:200px}
.meta-text h1{font-size:1.4em;margin-bottom:8px;color:#e0e0e0}
.meta-text p{color:#888;margin-bottom:4px;font-size:0.9em}
.spa-badge{display:inline-block;background:#f59e0b;color:#000;padding:3px 10px;border-radius:20px;font-size:0.75em;font-weight:600;margin-bottom:10px}
.stats{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.stat{background:#1a1a2e;border:1px solid #2a2a3e;border-radius:10px;padding:10px 16px;flex:1;min-width:100px;text-align:center}
.stat-num{font-size:1.5em;font-weight:700;color:#7c5cfc}
.stat-label{font-size:0.75em;color:#888}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:15px}
.res-card{background:#1a1a2e;border-radius:12px;border:1px solid #2a2a3e;overflow:hidden;transition:transform 0.2s}
.res-card:hover{transform:translateY(-3px);border-color:#7c5cfc}
.res-thumb{width:100%;height:180px;object-fit:cover;background:#0a0a1a;display:block}
.res-placeholder{width:100%;height:180px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);display:flex;align-items:center;justify-content:center;font-size:3em}
.res-info{padding:12px 14px}
.res-name{color:#ccc;font-size:0.85em;word-break:break-all;margin-bottom:2px;font-weight:600}
.res-label{color:#666;font-size:0.75em;margin-bottom:8px}
.res-actions{display:flex;gap:6px}
.btn-download{flex:1;padding:8px;border-radius:8px;border:none;background:#22c55e;color:#fff;font-size:0.85em;cursor:pointer;font-weight:600;text-align:center;text-decoration:none;display:block}
.btn-download:hover{background:#1eae4a}
.btn-open{padding:8px 12px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:0.85em;cursor:pointer;font-weight:600;text-decoration:none;display:block}
.btn-open:hover{background:#2b6de0}
.btn-dl-all{padding:14px 24px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-size:1em;cursor:pointer;font-weight:600;margin-bottom:20px}
.btn-dl-all:hover{background:#1eae4a}
.tip{background:#2a1a3e;border:1px solid #5a2a5a;border-radius:10px;padding:15px;margin-bottom:20px;color:#c084fc;font-size:0.85em;line-height:1.5}
</style>
</head>
<body>
<div class="container">
  <div class="toolbar">
    <span class="logo">🪞 ESPEJO</span>
    <span class="url">${originalUrl}</span>
    <a href="/" style="background:#555">🏠 Inicio</a>
  </div>

  <div class="meta-section">
    ${ogImage ? `<img class="meta-image" src="/api/browse?url=${encodeURIComponent(ogImage)}" alt="Portada" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="meta-placeholder" style="display:none">🎵</div>` : `<div class="meta-placeholder">🎵</div>`}
    <div class="meta-text">
      <span class="spa-badge">⚡ Sitio JavaScript — recursos extraídos</span>
      <h1>${title}</h1>
      ${description ? `<p>${description}</p>` : ""}
      <p style="color:#555;font-size:0.8em;margin-top:8px">🔗 ${originalUrl}</p>
    </div>
  </div>

  <div class="tip">
    💡 Este sitio carga su contenido con JavaScript (como Spotify, Instagram, etc.). No podemos mostrar la página completa, pero <strong>extraemos todas las imágenes y archivos</strong> que encontramos en el código fuente. Cada uno tiene un botón de descarga.
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-num">${resources.length}</div><div class="stat-label">Total recursos</div></div>
    <div class="stat"><div class="stat-num">${resources.filter(r=>r.type==="image").length}</div><div class="stat-label">🖼️ Imágenes</div></div>
    <div class="stat"><div class="stat-num">${resources.filter(r=>r.type==="file").length}</div><div class="stat-label">📎 Archivos</div></div>
    <div class="stat"><div class="stat-num">${resources.filter(r=>r.type==="media").length}</div><div class="stat-label">🎬 Media</div></div>
  </div>

  ${resources.filter(r=>r.type==="image"||r.type==="file").length > 0 ? `<button class="btn-dl-all" onclick="downloadAll()">⬇️ Descargar todo (${resources.filter(r=>r.type==="image"||r.type==="file").length})</button>` : ""}

  <div class="grid">
    ${resourceCards}
  </div>
</div>

<script>
function downloadAll(){
  const btns = document.querySelectorAll('.btn-download');
  btns.forEach((btn, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = btn.href;
      a.download = '';
      a.click();
    }, i * 800);
  });
}
</script>
</body>
</html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ═══════════════════════════════════════════════════
   REESCRIBIR URLs EN HTML (para sitios estáticos)
   ═══════════════════════════════════════════════════ */

function rewriteHtmlUrls(html, baseUrl) {
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url, baseUrl)}${post}`);
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url, baseUrl)}${post}`);
  html = html.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, srcset, post) => {
    const r = srcset.split(",").map(p => { const t=p.trim(); const s=t.indexOf(" "); return s===-1?rw(t,baseUrl):rw(t.substring(0,s),baseUrl)+t.substring(s); }).join(", ");
    return `${pre}${r}${post}`;
  });
  for (const a of ["data-src","data-lazy-src","data-original","data-lazy","data-image","data-zoom-image","data-bg","data-bg-url"]) {
    html = html.replace(new RegExp(`(${a}\\s*=\\s*["'])([^"']+)(["'])`,"gi"), (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  }
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, url) => {
    if (url.startsWith("data:")||url.startsWith("#")||url.startsWith("blob:")) return m;
    try { return `url(/api/browse?url=${encodeURIComponent(new URL(url,baseUrl).href)})`; } catch { return m; }
  });
  html = html.replace(/(action\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  html = html.replace(/(poster\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  return html;
}

function rw(url, baseUrl) {
  if (!url||url.startsWith("#")||url.startsWith("javascript:")||url.startsWith("mailto:")||url.startsWith("data:")||url.startsWith("blob:")||url.startsWith("about:")||url.startsWith("/api/browse")) return url;
  try { return `/api/browse?url=${encodeURIComponent(new URL(url,baseUrl).href)}`; } catch { return url; }
}

/* ═══════════════════════════════════════════════════
   REESCRIBIR URLs EN CSS
   ═══════════════════════════════════════════════════ */

function rewriteCssUrls(css, cssBaseUrl) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, url) => {
    if (url.startsWith("data:")||url.startsWith("#")||url.startsWith("blob:")) return m;
    try { return `url(/api/browse?url=${encodeURIComponent(new URL(url,cssBaseUrl).href)})`; } catch { return m; }
  });
}

/* ═══════════════════════════════════════════════════
   TOOLBAR (sitios estáticos)
   ═══════════════════════════════════════════════════ */

function injectToolbar(html, currentUrl, originalUrl) {
  const esc = originalUrl.replace(/'/g,"\\'").replace(/"/g,"&quot;");
  const toolbar = `
<div id="__mt__" style="position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:linear-gradient(135deg,#1a1a2e,#2a1a3e)!important;border-bottom:2px solid #7c5cfc!important;padding:8px 15px!important;display:flex!important;align-items:center!important;gap:10px!important;font-family:'Segoe UI',sans-serif!important;font-size:13px!important;color:#e0e0e0!important;box-shadow:0 2px 20px rgba(0,0,0,0.5)!important">
  <div style="font-weight:700!important;color:#7c5cfc!important;font-size:14px!important;flex-shrink:0!important">🪞 ESPEJO</div>
  <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888" title="${esc}">${originalUrl.length>50?originalUrl.substring(0,50)+"...":originalUrl}</div>
  <button onclick="var a=document.createElement('a');a.href='/api/download?url='+encodeURIComponent('${esc}');a.download='pagina.html';a.click()" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#22c55e!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;flex-shrink:0!important">⬇️ Descargar</button>
  <button onclick="var p=document.getElementById('__mrp__');p.style.display=p.style.display==='none'?'block':'none'" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#3b82f6!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;flex-shrink:0!important">📋 Recursos</button>
  <button onclick="location.href='/'" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#555!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;flex-shrink:0!important">🏠</button>
</div>
<div style="height:42px!important"></div>
<div id="__mrp__" style="position:fixed!important;top:42px!important;right:0!important;bottom:0!important;width:360px!important;z-index:2147483646!important;background:#1a1a2e!important;border-left:2px solid #7c5cfc!important;display:none!important;overflow-y:auto!important;padding:15px!important;font-family:'Segoe UI',sans-serif!important;color:#e0e0e0!important;box-shadow:-5px 0 30px rgba(0,0,0,0.5)!important">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px"><h3 style="margin:0;color:#7c5cfc;font-size:16px">📋 Recursos</h3><button onclick="document.getElementById('__mrp__').style.display='none'" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px">✕</button></div>
  <div id="__mrl__" style="font-size:12px;color:#888">Escaneando...</div>
</div>
<script>
(function(){
  try{document.body.style.paddingTop='42px'}catch(e){}
  var _s=false;
  function scan(){
    if(_s)return;_s=true;
    var l=document.getElementById('__mrl__'),res=[],seen={};
    function add(u,t,lb){if(!u||u.startsWith('data:')||u.startsWith('blob:'))return;var r=u;try{if(u.indexOf('/api/browse?url=')>-1)r=decodeURIComponent(u.split('/api/browse?url=')[1].split('&')[0]);if(!r.startsWith('http')||seen[r])return;seen[r]=1;var fn=r.split('/').pop().split('?')[0]||'recurso';res.push({url:r,type:t,label:lb,filename:fn})}catch(e){}}
    document.querySelectorAll('img').forEach(function(i){add(i.src||i.dataset.src,'image',i.alt||'')});
    document.querySelectorAll('a[href]').forEach(function(a){add(a.href,'link',(a.textContent||'').trim().substring(0,30))});
    document.querySelectorAll('video,source,audio').forEach(function(v){if(v.src)add(v.src,'media','media')});
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){if(l.href)add(l.href,'css','CSS')});
    if(res.length===0){l.innerHTML='<p style="color:#666">No se encontraron recursos</p>';return}
    var g={};res.forEach(function(r){(g[r.type]=g[r.type]||[]).push(r)});
    var ic={image:'🖼️',link:'🔗',media:'🎬',css:'🎨'},nm={image:'Imágenes',link:'Enlaces',media:'Media',css:'CSS'},h='';
    var dl=res.filter(function(r){return r.filename&&r.filename.indexOf('.')>-1&&r.type!=='link'});
    if(dl.length>0)h+='<button onclick="__dla()" style="width:100%;padding:8px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:600;margin-bottom:12px;font-size:12px">⬇️ Descargar '+dl.length+'</button>';
    for(var t in g){var it=g[t];h+='<div style="color:#7c5cfc;font-weight:600;margin:10px 0 5px">'+(ic[t]||'📎')+' '+(nm[t]||t)+' ('+it.length+')</div>';it.forEach(function(r){var isD=r.type!=='link'&&r.filename&&r.filename.indexOf('.')>-1;h+='<div style="background:#2a2a3e;border-radius:6px;padding:6px 8px;margin-bottom:3px;display:flex;gap:4px;align-items:center"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;font-size:11px">'+r.filename.substring(0,28)+'</span>';if(isD)h+='<a href="/api/download?url='+encodeURIComponent(r.url)+'&filename='+encodeURIComponent(r.filename)+'" download style="padding:2px 6px;border-radius:4px;background:#22c55e;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0">⬇</a>';h+='<a href="'+r.url+'" target="_blank" style="padding:2px 6px;border-radius:4px;background:#3b82f6;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0">🔗</a></div>'})}
    l.innerHTML=h;
    window.__dla=function(){dl.forEach(function(r,i){setTimeout(function(){var a=document.createElement('a');a.href='/api/download?url='+encodeURIComponent(r.url)+'&filename='+encodeURIComponent(r.filename);a.click()},i*800)})}
  }
  setTimeout(scan,1500);
  document.getElementById('__mrp__').addEventListener('transitionend',scan);
  var obs=new MutationObserver(function(){_s=false;scan()});
  setTimeout(function(){try{obs.observe(document.body,{childList:true,subtree:true})}catch(e){}},2000);
})();
</script>`;

  if (html.includes("</body>")) return html.replace("</body>", toolbar + "\n</body>");
  if (html.includes("</BODY>")) return html.replace("</BODY>", toolbar + "\n</BODY>");
  return html + toolbar;
}

function errorPage(status, customMsg) {
  const msg = customMsg || `Error ${status}`;
  return new NextResponse(`<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:3em;margin-bottom:15px">❌</div><h1>Error</h1><p style="color:#888;margin-top:10px">${msg}</p><a href="/" style="color:#7c5cfc;margin-top:20px;display:inline-block">← Volver</a></div></body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
}
