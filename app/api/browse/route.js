import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   API /api/browse — PROXY WEB COMPLETO (v6 — Embed support)
   
   3 modos:
   1. Spotify/YouTube/etc → Usa oEmbed API + embed player real
   2. Otros SPAs (Instagram, etc.) → Extrae recursos del HTML
   3. Sitios normales → Proxy completo con reescritura de URLs
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
};

const IMAGE_EXTS = new Set([".jpg",".jpeg",".png",".gif",".webp",".svg",".bmp",".ico",".tiff",".tif",".avif"]);
const BINARY_EXTS = new Set([".pdf",".zip",".rar",".7z",".tar",".gz",".bz2",".mp4",".mp3",".wav",".avi",".mkv",".mov",".flv",".wmv",".webm",".m4a",".aac",".flac",".ogg",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".exe",".dmg",".iso",".apk",".epub",".mobi",".woff",".woff2",".ttf",".eot",".otf"]);
const IMAGE_CDNS = ["i.scdn.co","image-cdn","mosaic.scdn.co","i.imgur.com","pbs.twimg.com"];

// ── Sitios con oEmbed API ──
const OEMBED_PROVIDERS = {
  "open.spotify.com": { endpoint: "https://open.spotify.com/oembed", name: "Spotify" },
  "www.youtube.com": { endpoint: "https://www.youtube.com/oembed", name: "YouTube" },
  "youtu.be": { endpoint: "https://www.youtube.com/oembed", name: "YouTube" },
  "soundcloud.com": { endpoint: "https://soundcloud.com/oembed", name: "SoundCloud" },
  "w.soundcloud.com": { endpoint: "https://soundcloud.com/oembed", name: "SoundCloud" },
  "vimeo.com": { endpoint: "https://vimeo.com/api/oembed.json", name: "Vimeo" },
  "player.vimeo.com": { endpoint: "https://vimeo.com/api/oembed.json", name: "Vimeo" },
  "www.tiktok.com": { endpoint: "https://www.tiktok.com/oembed", name: "TikTok" },
  "vm.tiktok.com": { endpoint: "https://www.tiktok.com/oembed", name: "TikTok" },
};

const SPA_DOMAINS = ["www.instagram.com","twitter.com","x.com","www.facebook.com","m.facebook.com","www.netflix.com","discord.com","t.me","web.telegram.org"];

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname).split("/").pop();
    if (!name || name.length < 2) name = `download_${Date.now() % 10000}`;
    return name.replace(/[^\w.\-]/g, "_").substring(0, 100);
  } catch { return "download"; }
}

function isBinaryDownload(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    return dot > -1 && BINARY_EXTS.has(path.substring(dot));
  } catch { return false; }
}

function getOembedProvider(url) {
  try {
    const hostname = new URL(url).hostname;
    return OEMBED_PROVIDERS[hostname] || null;
  } catch { return null; }
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
    // ── MODO 1: oEmbed (Spotify, YouTube, etc.) ──
    const provider = getOembedProvider(targetUrl);
    if (provider) {
      return await handleOembed(targetUrl, provider);
    }

    // ── Fetch normal ──
    const reqHeaders = { ...BROWSER_HEADERS };
    try {
      const hostname = new URL(targetUrl).hostname;
      if (hostname.includes("spotify.com")) {
        reqHeaders["Cookie"] = "sp_t=a1b2c3d4e5f6g7h8";
      }
    } catch {}

    const resp = await fetch(targetUrl, { headers: reqHeaders, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!resp.ok) return errorPage(resp.status, undefined, targetUrl);
    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;

    // No es HTML: servir directo
    if (!contentType.includes("text/html") && !contentType.includes("text/xhtml") && !contentType.includes("application/xhtml")) {
      const body = await resp.arrayBuffer();
      const headers = { "Content-Type": contentType || "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" };
      if (isBinaryDownload(targetUrl)) headers["Content-Disposition"] = `attachment; filename="${filenameFromUrl(targetUrl)}"`;
      return new NextResponse(body, { status: 200, headers });
    }

    // ── Es HTML ──
    let html = await resp.text();
    const spaDetected = isSpa(targetUrl) || detectSpaFromHtml(html);

    if (spaDetected) {
      // MODO 2: SPA → extraer recursos y galería
      const resources = extractResources(html, finalUrl);
      const meta = extractMeta(html);
      return spaGalleryPage(targetUrl, finalUrl, resources, meta);
    }

    // MODO 3: Proxy normal
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
   MODO 1: OEMBED — Spotify, YouTube, SoundCloud, etc.
   Usa la API oficial del sitio para obtener:
   - Título, descripción, imagen de portada
   - Embed HTML (reproductor real que funciona)
   ═══════════════════════════════════════════════════ */

async function handleOembed(url, provider) {
  try {
    const oembedUrl = `${provider.endpoint}?url=${encodeURIComponent(url)}&maxwidth=600&maxheight=800`;
    const resp = await fetch(oembedUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    let oembed = null;
    if (resp.ok) {
      try { oembed = await resp.json(); } catch {}
    }

    // Also fetch the page to extract more images
    let extraImages = [];
    let pageMeta = {};
    try {
      const pageResp = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (pageResp.ok) {
        const pageHtml = await pageResp.text();
        pageMeta = extractMeta(pageHtml);
        const resources = extractResources(pageHtml, pageResp.url || url);
        extraImages = resources.filter(r => r.type === "image");
      }
    } catch {}

    return oembedPage(url, provider, oembed, extraImages, pageMeta);
  } catch (e) {
    // If oEmbed fails, fall back to SPA mode
    const resp = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (resp.ok) {
      const html = await resp.text();
      const resources = extractResources(html, resp.url || url);
      const meta = extractMeta(html);
      return spaGalleryPage(url, resp.url || url, resources, meta);
    }
    return errorPage(0, e.message);
  }
}

function oembedPage(originalUrl, provider, oembed, extraImages, pageMeta) {
  const title = oembed?.title || pageMeta.title || "Contenido";
  const thumbnail = oembed?.thumbnail_url || pageMeta.image || "";
  const providerName = provider.name;
  const embedHtml = oembed?.html || "";
  const embedWidth = oembed?.width || 600;
  const embedHeight = oembed?.height || 400;

  // Build list of downloadable images
  const allImages = [];
  const seenUrls = new Set();
  
  // Add thumbnail first
  if (thumbnail && !seenUrls.has(thumbnail)) {
    seenUrls.add(thumbnail);
    allImages.push({ url: thumbnail, filename: `cover_${filenameFromUrl(thumbnail)}`, label: "Portada" });
  }
  
  // Add extra images from page
  for (const img of extraImages) {
    if (!seenUrls.has(img.url)) {
      seenUrls.add(img.url);
      allImages.push(img);
    }
  }

  const imageCards = allImages.map((r, i) => {
    const proxyUrl = `/api/browse?url=${encodeURIComponent(r.url)}`;
    return `
      <div class="img-card">
        <img class="img-thumb" src="${proxyUrl}" alt="${r.filename}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div class="img-placeholder" style="display:none">🖼️</div>
        <div class="img-info">
          <div class="img-name">${r.filename.substring(0, 30)}</div>
          <div class="img-label">${r.label}</div>
          <div class="img-actions">
            <a class="btn-dl" href="/api/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(r.filename)}" download>⬇️ Descargar</a>
            <a class="btn-open" href="${r.url}" target="_blank">🔗</a>
          </div>
        </div>
      </div>`;
  }).join("");

  return new NextResponse(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🪞 ${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0f0f1a;color:#e0e0e0;min-height:100vh}
.wrap{max-width:800px;margin:0 auto;padding:20px}
.topbar{position:sticky;top:0;z-index:999;background:linear-gradient(135deg,#1a1a2e,#2a1a3e);border-bottom:2px solid #1ed760;padding:10px 15px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 20px rgba(0,0,0,0.5);margin:-20px -20px 20px}
.topbar .logo{font-weight:700;color:#1ed760;font-size:14px}
.topbar .url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888;font-size:11px}
.topbar a{padding:5px 12px;border-radius:6px;border:none;color:#fff;cursor:pointer;font-weight:600;font-size:12px;text-decoration:none}
.hero{background:#1a1a2e;border-radius:16px;padding:25px;margin-bottom:25px;border:1px solid #2a2a3e;display:flex;gap:25px;align-items:flex-start;flex-wrap:wrap}
.hero-img{width:200px;height:200px;border-radius:12px;object-fit:cover;flex-shrink:0;box-shadow:0 8px 30px rgba(0,0,0,0.4)}
.hero-ph{width:200px;height:200px;border-radius:12px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);display:flex;align-items:center;justify-content:center;font-size:4em;flex-shrink:0}
.hero-text{flex:1;min-width:200px}
.hero-text h1{font-size:1.5em;margin-bottom:8px;color:#e0e0e0;line-height:1.3}
.hero-text p{color:#888;margin-bottom:4px;font-size:0.9em}
.badge{display:inline-block;background:#1ed760;color:#000;padding:3px 10px;border-radius:20px;font-size:0.75em;font-weight:600;margin-bottom:10px}
.embed-section{background:#1a1a2e;border-radius:16px;padding:20px;margin-bottom:25px;border:1px solid #2a2a3e}
.embed-section h2{font-size:1.2em;margin-bottom:15px;color:#1ed760}
.embed-frame{width:100%;border-radius:12px;overflow:hidden;background:#000}
.embed-frame iframe{width:100%;border:none;border-radius:12px}
.img-section h2{font-size:1.2em;margin-bottom:5px;color:#7c5cfc}
.img-section .sub{color:#888;font-size:0.85em;margin-bottom:15px}
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:20px}
.img-card{background:#1a1a2e;border-radius:12px;border:1px solid #2a2a3e;overflow:hidden;transition:transform 0.2s}
.img-card:hover{transform:translateY(-3px);border-color:#7c5cfc}
.img-thumb{width:100%;height:160px;object-fit:cover;background:#0a0a1a;display:block}
.img-placeholder{width:100%;height:160px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);display:flex;align-items:center;justify-content:center;font-size:2.5em}
.img-info{padding:10px 12px}
.img-name{color:#ccc;font-size:0.8em;word-break:break-all;margin-bottom:2px;font-weight:600}
.img-label{color:#666;font-size:0.7em;margin-bottom:6px}
.img-actions{display:flex;gap:4px}
.btn-dl{flex:1;padding:6px;border-radius:6px;border:none;background:#22c55e;color:#fff;font-size:0.8em;cursor:pointer;font-weight:600;text-align:center;text-decoration:none;display:block}
.btn-dl:hover{background:#1eae4a}
.btn-open{padding:6px 10px;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:0.8em;cursor:pointer;font-weight:600;text-decoration:none;display:block}
.btn-all{padding:12px 20px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-size:1em;cursor:pointer;font-weight:600;margin-bottom:20px}
.btn-all:hover{background:#1eae4a}
.tip{background:#1a2a1a;border:1px solid #2a3e2a;border-radius:10px;padding:15px;margin-bottom:20px;color:#6ee7b7;font-size:0.85em;line-height:1.5}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <span class="logo">🪞 ESPEJO</span>
    <span class="url">${originalUrl}</span>
    <a href="/" style="background:#555">🏠 Inicio</a>
  </div>

  <div class="hero">
    ${thumbnail ? `<img class="hero-img" src="/api/browse?url=${encodeURIComponent(thumbnail)}" alt="Portada" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="hero-ph" style="display:none">🎵</div>` : `<div class="hero-ph">🎵</div>`}
    <div class="hero-text">
      <span class="badge">🎵 ${providerName}</span>
      <h1>${title}</h1>
      ${pageMeta.description ? `<p>${pageMeta.description}</p>` : ""}
      <p style="color:#555;font-size:0.8em;margin-top:8px">🔗 ${originalUrl}</p>
    </div>
  </div>

  ${embedHtml ? `
  <div class="embed-section">
    <h2>▶️ Reproductor ${providerName}</h2>
    <div class="embed-frame">
      ${embedHtml.replace(/width="[^"]*"/, 'width="100%"').replace(/height="[^"]*"/, `height="${Math.min(embedHeight, 480)}"`)}
    </div>
  </div>` : `
  <div class="tip">
    ⚠️ No se pudo obtener el reproductor de ${providerName}. Pero las imágenes de abajo se pueden descargar.
  </div>`}

  ${allImages.length > 0 ? `
  <div class="img-section">
    <h2>🖼️ Imágenes y recursos</h2>
    <p class="sub">${allImages.length} imágenes encontradas — cada una con botón de descarga</p>
    ${allImages.length > 1 ? `<button class="btn-all" onclick="dlAll()">⬇️ Descargar todas (${allImages.length})</button>` : ""}
    <div class="img-grid">
      ${imageCards}
    </div>
  </div>` : ""}
</div>

<script>
function dlAll(){
  document.querySelectorAll('.btn-dl').forEach((btn,i) => {
    setTimeout(() => { var a=document.createElement('a'); a.href=btn.href; a.download=''; a.click(); }, i*800);
  });
}
</script>
</body>
</html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ═══════════════════════════════════════════════════
   SPA DETECTION
   ═══════════════════════════════════════════════════ */

function detectSpaFromHtml(html) {
  const scriptTags = (html.match(/<script/gi) || []).length;
  const bodyContent = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || ["",""])[1];
  const realContent = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
  if (scriptTags > 5 && realContent.length < 200) return true;
  if (html.includes('id="root"') || html.includes('id="__next"') || html.includes('id="app"') || html.includes('ng-app') || html.includes('__NUXT')) return true;
  return false;
}

/* ═══════════════════════════════════════════════════
   RESOURCE EXTRACTION
   ═══════════════════════════════════════════════════ */

function extractResources(html, baseUrl) {
  const resources = [];
  const seen = new Set();
  function add(url, type, label) {
    try {
      if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:")) return;
      let full; try { full = new URL(url, baseUrl).href; } catch { return; }
      if (!full.startsWith("http")) return;
      if (seen.has(full)) return;
      seen.add(full);
      let filename = filenameFromUrl(full);
      if (!filename.includes(".") || filename.startsWith("image_")) {
        const hash = Math.abs(full.length * 31 + (full.charCodeAt(full.length-1) || 0)) % 10000;
        if (type === "image") filename = `image_${hash}.jpg`;
        else filename = `file_${hash}`;
      }
      resources.push({ url: full, type, label: label || filename, filename });
    } catch {}
  }

  // Meta images
  for (const m of html.matchAll(/content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["'](?:og:image|twitter:image)["']/gi)) add(m[1], "image", "Portada");
  for (const m of html.matchAll(/property\s*=\s*["'](?:og:image|twitter:image)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) add(m[1], "image", "Portada");

  // <img>
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src|data-original|data-lazy|data-image)\s*=\s*["']([^"']+)["']/gi)) add(m[1], "image", "Imagen");

  // Links with files
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

  // <source>
  for (const m of html.matchAll(/<source[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1], "media", "Media");

  // CSS url()
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

  // Favicon
  for (const m of html.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["']/gi)) add(m[1], "image", "Favicon");

  // Aggressive: image URLs
  const imgUrlPattern = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif|ico)(?:\?[^\s"'<>]*)?/gi;
  for (const m of html.matchAll(imgUrlPattern)) add(m[0], "image", "Imagen");

  // Aggressive: CDN images without extension (Spotify, etc.)
  for (const cdn of IMAGE_CDNS) {
    const cdnPattern = new RegExp(`https?://[^\\s"'<>]*${cdn.replace(/\./g, "\\.")}/[^\\s"'<>]+`, "gi");
    for (const m of html.matchAll(cdnPattern)) {
      const url = m[0].replace(/[,;)\]}]+$/, "");
      if (url.length > 20 && url.length < 500) add(url, "image", "Imagen CDN");
    }
  }

  // JSON-LD
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data.image) {
        if (typeof data.image === "string") add(data.image, "image", "Portada");
        else if (Array.isArray(data.image)) data.image.forEach(i => add(typeof i === "string" ? i : i.url, "image", "Portada"));
      }
    } catch {}
  }

  return resources;
}

function extractMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/property\s*=\s*["']og:([^"']+)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) meta[m[1]] = m[2];
  for (const m of html.matchAll(/content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:([^"']+)["']/gi)) meta[m[2]] = m[1];
  for (const m of html.matchAll(/name\s*=\s*["']twitter:([^"']+)["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) { if (!meta[m[1]]) meta[m[1]] = m[2]; }
  for (const m of html.matchAll(/name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']+)["']/gi)) { if (!meta.description) meta.description = m[1]; }
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) meta.htmlTitle = titleMatch[1].trim();
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      if (data.name && !meta.title) meta.title = data.name;
      if (data.description && !meta.description) meta.description = data.description;
      if (data.image && !meta.image) meta.image = typeof data.image === "string" ? data.image : "";
      if (data.datePublished) meta.date = data.datePublished;
    } catch {}
  }
  if (!meta.title) meta.title = meta.htmlTitle;
  return meta;
}

/* ═══════════════════════════════════════════════════
   SPA GALLERY (for non-oEmbed SPAs)
   ═══════════════════════════════════════════════════ */

function spaGalleryPage(originalUrl, finalUrl, resources, meta) {
  const title = meta.title || meta["site_name"] || "Espejo";
  const description = meta.description || "";
  const ogImage = meta.image || "";
  const resourceCards = resources.map(r => {
    const isImg = r.type === "image";
    const icon = {image:"🖼️",file:"📎",media:"🎬"}[r.type]||"📎";
    const proxyUrl = `/api/browse?url=${encodeURIComponent(r.url)}`;
    return `<div style="background:#1a1a2e;border-radius:12px;border:1px solid #2a2a3e;overflow:hidden;display:flex;flex-direction:column">
      ${isImg?`<img style="width:100%;height:160px;object-fit:cover;background:#0a0a1a" src="${proxyUrl}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none;width:100%;height:160px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);align-items:center;justify-content:center;font-size:2.5em">${icon}</div>`:`<div style="width:100%;height:160px;background:linear-gradient(135deg,#1a1a2e,#2a2a3e);display:flex;align-items:center;justify-content:center;font-size:2.5em">${icon}</div>`}
      <div style="padding:10px 12px">
        <div style="color:#ccc;font-size:0.8em;word-break:break-all;margin-bottom:2px;font-weight:600">${r.filename.substring(0,30)}</div>
        <div style="color:#666;font-size:0.7em;margin-bottom:6px">${r.label}</div>
        <div style="display:flex;gap:4px">
          <a style="flex:1;padding:6px;border-radius:6px;background:#22c55e;color:#fff;font-size:0.8em;text-decoration:none;text-align:center;font-weight:600" href="/api/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(r.filename)}" download>⬇️</a>
          <a style="padding:6px 10px;border-radius:6px;background:#3b82f6;color:#fff;font-size:0.8em;text-decoration:none;font-weight:600" href="${r.url}" target="_blank">🔗</a>
        </div>
      </div>
    </div>`;
  }).join("");

  return new NextResponse(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>🪞 ${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0f0f1a;color:#e0e0e0;min-height:100vh}.w{max-width:900px;margin:0 auto;padding:20px}.tb{position:sticky;top:0;z-index:999;background:linear-gradient(135deg,#1a1a2e,#2a1a3e);border-bottom:2px solid #7c5cfc;padding:10px 15px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 2px 20px rgba(0,0,0,0.5);margin:-20px -20px 20px}</style>
</head><body><div class="w">
<div class="tb"><span style="font-weight:700;color:#7c5cfc;font-size:14px">🪞 ESPEJO</span><span style="flex:1;color:#888;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${originalUrl}</span><a href="/" style="padding:5px 12px;border-radius:6px;background:#555;color:#fff;text-decoration:none;font-size:12px">🏠</a></div>
<div style="background:#1a1a2e;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #2a2a3e;display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
${ogImage?`<img style="width:160px;height:160px;border-radius:10px;object-fit:cover;flex-shrink:0" src="/api/browse?url=${encodeURIComponent(ogImage)}" onerror="this.style.display='none'" />`:``}
<div style="flex:1;min-width:200px"><span style="display:inline-block;background:#f59e0b;color:#000;padding:3px 10px;border-radius:20px;font-size:0.75em;font-weight:600;margin-bottom:8px">⚡ Sitio JavaScript</span><h1 style="font-size:1.3em;margin-bottom:6px">${title}</h1>${description?`<p style="color:#888;font-size:0.9em">${description}</p>`:``}<p style="color:#555;font-size:0.8em;margin-top:6px">🔗 ${originalUrl}</p></div></div>
${resources.filter(r=>r.type==="image"||r.type==="file").length>0?`<button onclick="document.querySelectorAll('.w a[href*=download]').forEach((a,i)=>setTimeout(()=>{var b=document.createElement('a');b.href=a.href;b.download='';b.click()},i*800))" style="padding:12px 20px;border-radius:10px;border:none;background:#22c55e;color:#fff;font-size:1em;cursor:pointer;font-weight:600;margin-bottom:15px">⬇️ Descargar todo</button>`:``}
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${resourceCards}</div>
</div></body></html>`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ═══════════════════════════════════════════════════
   URL REWRITING (normal proxy mode)
   ═══════════════════════════════════════════════════ */

function rewriteHtmlUrls(html, baseUrl) {
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  html = html.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, srcset, post) => {
    const r = srcset.split(",").map(p => { const t=p.trim(); const s=t.indexOf(" "); return s===-1?rw(t,baseUrl):rw(t.substring(0,s),baseUrl)+t.substring(s); }).join(", ");
    return `${pre}${r}${post}`;
  });
  for (const a of ["data-src","data-lazy-src","data-original","data-lazy","data-image","data-zoom-image"]) {
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
   TOOLBAR (normal proxy mode)
   ═══════════════════════════════════════════════════ */

function injectToolbar(html, currentUrl, originalUrl) {
  const esc = originalUrl.replace(/'/g,"\\'").replace(/"/g,"&quot;");
  const toolbar = `
<div id="__mt__" style="position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:linear-gradient(135deg,#1a1a2e,#2a1a3e)!important;border-bottom:2px solid #7c5cfc!important;padding:8px 15px!important;display:flex!important;align-items:center!important;gap:10px!important;font-family:sans-serif!important;font-size:13px!important;color:#e0e0e0!important;box-shadow:0 2px 20px rgba(0,0,0,.5)!important">
  <div style="font-weight:700!important;color:#7c5cfc!important;font-size:14px!important;flex-shrink:0!important">🪞 ESPEJO</div>
  <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888" title="${esc}">${originalUrl.length>50?originalUrl.substring(0,50)+"...":originalUrl}</div>
  <button onclick="var a=document.createElement('a');a.href='/api/download?url='+encodeURIComponent('${esc}');a.download='pagina.html';a.click()" style="padding:5px 12px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:12px;font-weight:600;flex-shrink:0">⬇️ Descargar</button>
  <button onclick="var p=document.getElementById('__mrp__');p.style.display=p.style.display==='none'?'block':'none'" style="padding:5px 12px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:12px;font-weight:600;flex-shrink:0">📋 Recursos</button>
  <button onclick="location.href='/'" style="padding:5px 12px;border-radius:6px;border:none;background:#555;color:#fff;cursor:pointer;font-size:12px;font-weight:600;flex-shrink:0">🏠</button>
</div>
<div style="height:42px!important"></div>
<div id="__mrp__" style="position:fixed!important;top:42px!important;right:0!important;bottom:0!important;width:360px!important;z-index:2147483646!important;background:#1a1a2e!important;border-left:2px solid #7c5cfc!important;display:none!important;overflow-y:auto!important;padding:15px!important;font-family:sans-serif!important;color:#e0e0e0!important;box-shadow:-5px 0 30px rgba(0,0,0,.5)!important">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px"><h3 style="margin:0;color:#7c5cfc;font-size:16px">📋 Recursos</h3><button onclick="document.getElementById('__mrp__').style.display='none'" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px">✕</button></div>
  <div id="__mrl__" style="font-size:12px;color:#888">Escaneando...</div>
</div>
<script>
(function(){try{document.body.style.paddingTop='42px'}catch(e){}
setTimeout(function(){var l=document.getElementById('__mrl__'),res=[],seen={};function add(u,t,lb){if(!u||u.startsWith('data:')||u.startsWith('blob:'))return;var r=u;try{if(u.indexOf('/api/browse?url=')>-1)r=decodeURIComponent(u.split('/api/browse?url=')[1].split('&')[0]);if(!r.startsWith('http')||seen[r])return;seen[r]=1;var fn=r.split('/').pop().split('?')[0]||'recurso';res.push({url:r,type:t,label:lb,filename:fn})}catch(e){}}
document.querySelectorAll('img').forEach(function(i){add(i.src||i.dataset.src,'image',i.alt||'')});
document.querySelectorAll('a[href]').forEach(function(a){add(a.href,'link',(a.textContent||'').trim().substring(0,30))});
document.querySelectorAll('video,source,audio').forEach(function(v){if(v.src)add(v.src,'media','media')});
if(res.length===0){l.innerHTML='<p style="color:#666">No se encontraron recursos</p>';return}
var g={};res.forEach(function(r){(g[r.type]=g[r.type]||[]).push(r)});
var ic={image:'🖼️',link:'🔗',media:'🎬'},nm={image:'Imágenes',link:'Enlaces',media:'Media'},h='';
var dl=res.filter(function(r){return r.filename&&r.filename.indexOf('.')>-1&&r.type!=='link'});
if(dl.length>0)h+='<button onclick="__dla()" style="width:100%;padding:8px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:600;margin-bottom:12px;font-size:12px">⬇️ Descargar '+dl.length+'</button>';
for(var t in g){var it=g[t];h+='<div style="color:#7c5cfc;font-weight:600;margin:10px 0 5px">'+(ic[t]||'📎')+' '+(nm[t]||t)+' ('+it.length+')</div>';it.forEach(function(r){var isD=r.type!=='link'&&r.filename&&r.filename.indexOf('.')>-1;h+='<div style="background:#2a2a3e;border-radius:6px;padding:6px 8px;margin-bottom:3px;display:flex;gap:4px;align-items:center"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;font-size:11px">'+r.filename.substring(0,28)+'</span>';if(isD)h+='<a href="/api/download?url='+encodeURIComponent(r.url)+'&filename='+encodeURIComponent(r.filename)+'" download style="padding:2px 6px;border-radius:4px;background:#22c55e;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0">⬇</a>';h+='<a href="'+r.url+'" target="_blank" style="padding:2px 6px;border-radius:4px;background:#3b82f6;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0">🔗</a></div>'})}
l.innerHTML=h;window.__dla=function(){dl.forEach(function(r,i){setTimeout(function(){var a=document.createElement('a');a.href='/api/download?url='+encodeURIComponent(r.url)+'&filename='+encodeURIComponent(r.filename);a.click()},i*800)})}},1500)})();
</script>`;
  if (html.includes("</body>")) return html.replace("</body>", toolbar + "\n</body>");
  if (html.includes("</BODY>")) return html.replace("</BODY>", toolbar + "\n</BODY>");
  return html + toolbar;
}

function errorPage(status, customMsg, url) {
  const msg = customMsg || `Error ${status}`;
  return new NextResponse(`<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;max-width:400px"><div style="font-size:3em;margin-bottom:15px">❌</div><h1>Error</h1><p style="color:#888;margin-top:10px;line-height:1.5">${msg}</p><a href="/" style="color:#7c5cfc;margin-top:20px;display:inline-block">← Volver</a></div></body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
}
