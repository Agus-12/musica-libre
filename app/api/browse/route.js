import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   API /api/browse — PROXY WEB COMPLETO (v3 — FIX blank page)
   
   Problemas que arregla esta versión:
   1. Imágenes se descargaban en vez de mostrarse (solo agregar
      Content-Disposition para archivos que NO son imágenes/CSS/JS)
   2. CSS con url() relativas se rompían (ahora se reescriben)
   3. JS dinámico que carga cosas (no se puede arreglar al 100%,
      pero mejoramos lo que podemos)
   ═══════════════════════════════════════════════════════════════ */

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".tif", ".avif",
]);

const BINARY_EXTS = new Set([
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
  ".mp4", ".mp3", ".wav", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm", ".m4a", ".aac", ".flac", ".ogg",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dmg", ".iso", ".apk",
  ".epub", ".mobi",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
]);

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(u.pathname).split("/").pop();
    if (!name || name.length < 2) name = `download_${Date.now() % 10000}`;
    return name.replace(/[^\w.\-]/g, "_").substring(0, 100);
  } catch {
    return "download";
  }
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

export async function GET(req) {
  const targetUrl = req.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Falta ?url=" }, { status: 400 });
  }

  try { new URL(targetUrl); } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      return errorPage(resp.status);
    }

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;

    // ── Si es HTML: reescribir e inyectar toolbar ──
    if (contentType.includes("text/html") || contentType.includes("text/xhtml") || contentType.includes("text/javascript") === false && contentType.includes("javascript")) {
      // Check more carefully
      if (contentType.includes("text/html") || contentType.includes("text/xhtml") || contentType.includes("application/xhtml")) {
        let html = await resp.text();
        html = rewriteHtmlUrls(html, finalUrl);
        html = injectToolbar(html, finalUrl, targetUrl);

        return new NextResponse(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "X-Frame-Options": "ALLOWALL",
          },
        });
      }
    }

    // ── Si es CSS: reescribir urls internas ──
    if (contentType.includes("text/css")) {
      let css = await resp.text();
      css = rewriteCssUrls(css, finalUrl);
      return new NextResponse(css, {
        status: 200,
        headers: {
          "Content-Type": "text/css",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ── Si es JavaScript: reescribir URLs dentro del JS ──
    if (contentType.includes("javascript") || contentType.includes("application/json")) {
      const body = await resp.text();
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ── Todo lo demás: servir directo ──
    const body = await resp.arrayBuffer();

    // Solo agregar Content-Disposition para archivos binarios descargables
    // NO para imágenes, CSS, JS, fuentes — esos se muestran inline
    const headers = {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    };

    if (isBinaryDownload(targetUrl)) {
      headers["Content-Disposition"] = `attachment; filename="${filenameFromUrl(targetUrl)}"`;
    }

    return new NextResponse(body, { status: 200, headers });
  } catch (e) {
    let msg = e.message;
    if (msg.includes("timeout")) msg = "El sitio tardó demasiado en responder";
    if (msg.includes("ENOTFOUND")) msg = "El dominio no existe";
    return errorPage(0, msg);
  }
}

function errorPage(status, customMsg) {
  const msg = customMsg || `El sitio respondió con error ${status}`;
  return new NextResponse(
    `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center;max-width:400px">
        <div style="font-size:3em;margin-bottom:15px">❌</div>
        <h1 style="font-size:1.5em;margin-bottom:10px">Error al cargar</h1>
        <p style="color:#888;line-height:1.5">${msg}</p>
        <p style="color:#555;font-size:0.85em;margin-top:10px">Algunos sitios bloquean peticiones de servidores.</p>
        <a href="/" style="color:#7c5cfc;margin-top:20px;display:inline-block">← Volver al inicio</a>
      </div>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

/* ═══════════════════════════════════════════════════
   REESCRIBIR URLs EN HTML
   ═══════════════════════════════════════════════════ */

function rewriteHtmlUrls(html, baseUrl) {
  // href="..." — Links HTML (navegar dentro del espejo)
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    return `${pre}${rewriteHtmlUrl(url, baseUrl, "href")}${post}`;
  });

  // src="..." — Recursos (imágenes, scripts, iframes)
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    return `${pre}${rewriteHtmlUrl(url, baseUrl, "src")}${post}`;
  });

  // srcset="img1 1x, img2 2x"
  html = html.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, srcset, post) => {
    const rewritten = srcset.split(",").map((part) => {
      const trimmed = part.trim();
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) return rewriteHtmlUrl(trimmed, baseUrl, "src");
      return rewriteHtmlUrl(trimmed.substring(0, spaceIdx), baseUrl, "src") + trimmed.substring(spaceIdx);
    }).join(", ");
    return `${pre}${rewritten}${post}`;
  });

  // data-* lazy loading attrs
  for (const attr of ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-image", "data-zoom-image", "data-bg", "data-bg-url"]) {
    const regex = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, "gi");
    html = html.replace(regex, (match, pre, url, post) => {
      return `${pre}${rewriteHtmlUrl(url, baseUrl, "src")}${post}`;
    });
  }

  // url() en CSS inline y style tags
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
    if (url.startsWith("data:") || url.startsWith("#") || url.startsWith("blob:")) return match;
    try {
      const full = new URL(url, baseUrl).href;
      return `url(/api/browse?url=${encodeURIComponent(full)})`;
    } catch { return match; }
  });

  // action="..." en forms
  html = html.replace(/(action\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    return `${pre}${rewriteHtmlUrl(url, baseUrl, "href")}${post}`;
  });

  // poster="..." en video
  html = html.replace(/(poster\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    return `${pre}${rewriteHtmlUrl(url, baseUrl, "src")}${post}`;
  });

  return html;
}

function rewriteHtmlUrl(url, baseUrl, attrType) {
  // No tocar especiales
  if (!url || url.startsWith("#") || url.startsWith("javascript:") ||
      url.startsWith("mailto:") || url.startsWith("data:") ||
      url.startsWith("blob:") || url.startsWith("about:") ||
      url.startsWith("/api/browse")) {
    return url;
  }

  try {
    const full = new URL(url, baseUrl).href;
    // Todo pasa por nuestro proxy
    return `/api/browse?url=${encodeURIComponent(full)}`;
  } catch {
    return url;
  }
}

/* ═══════════════════════════════════════════════════
   REESCRIBIR URLs EN CSS
   Los archivos CSS tienen url() que deben apuntar al proxy
   ═══════════════════════════════════════════════════ */

function rewriteCssUrls(css, cssBaseUrl) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
    if (url.startsWith("data:") || url.startsWith("#") || url.startsWith("blob:")) return match;
    try {
      const full = new URL(url, cssBaseUrl).href;
      return `url(/api/browse?url=${encodeURIComponent(full)})`;
    } catch { return match; }
  });
}

/* ═══════════════════════════════════════════════════
   INYECTAR BARRA FLOTANTE
   ═══════════════════════════════════════════════════ */

function injectToolbar(html, currentUrl, originalUrl) {
  const escapedUrl = originalUrl.replace(/'/g, "\\'").replace(/"/g, "&quot;");

  const toolbar = `
<!-- ═══ ESPEJO TOOLBAR ═══ -->
<div id="__mirror_toolbar__" style="
  position:fixed!important; top:0!important; left:0!important; right:0!important; z-index:2147483647!important;
  background:linear-gradient(135deg,#1a1a2e,#2a1a3e)!important;
  border-bottom:2px solid #7c5cfc!important;
  padding:8px 15px!important;
  display:flex!important; align-items:center!important; gap:10px!important;
  font-family:'Segoe UI',sans-serif!important; font-size:13px!important; color:#e0e0e0!important;
  box-shadow:0 2px 20px rgba(0,0,0,0.5)!important;
  margin:0!important; height:auto!important; width:auto!important;
">
  <div style="font-weight:700!important;color:#7c5cfc!important;font-size:14px!important;flex-shrink:0!important">🪞 ESPEJO</div>
  <div style="flex:1!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#888!important;max-width:400px!important" title="${escapedUrl}">
    ${originalUrl.length > 50 ? originalUrl.substring(0, 50) + "..." : originalUrl}
  </div>
  <button onclick="__mirrorDL__()" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#22c55e!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;white-space:nowrap!important;flex-shrink:0!important">⬇️ Descargar</button>
  <button onclick="__mirrorRes__()" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#3b82f6!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;white-space:nowrap!important;flex-shrink:0!important">📋 Recursos</button>
  <button onclick="location.href='/'" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#555!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;white-space:nowrap!important;flex-shrink:0!important">🏠</button>
</div>
<div id="__mirror_spacer__" style="height:42px!important;display:block!important"></div>

<!-- Panel de recursos -->
<div id="__mirror_res_panel__" style="
  position:fixed!important; top:42px!important; right:0!important; bottom:0!important; width:360px!important; z-index:2147483646!important;
  background:#1a1a2e!important; border-left:2px solid #7c5cfc!important;
  display:none!important; overflow-y:auto!important; padding:15px!important;
  font-family:'Segoe UI',sans-serif!important; color:#e0e0e0!important;
  box-shadow:-5px 0 30px rgba(0,0,0,0.5)!important;
">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
    <h3 style="margin:0;color:#7c5cfc;font-size:16px">📋 Recursos</h3>
    <button onclick="document.getElementById('__mirror_res_panel__').style.display='none'" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px">✕</button>
  </div>
  <div id="__mirror_res_list__" style="font-size:12px;color:#888">Escaneando...</div>
</div>

<script>
(function(){
  try { document.body.style.paddingTop = '42px'; } catch(e){}

  window.__mirrorDL__ = function(){
    var a = document.createElement('a');
    a.href = '/api/download?url=' + encodeURIComponent('${escapedUrl}');
    a.download = document.title ? document.title.replace(/[^\\w]/g,'_') + '.html' : 'pagina.html';
    a.click();
  };

  window.__mirrorRes__ = function(){
    var p = document.getElementById('__mirror_res_panel__');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
    if(p.style.display === 'block') scanRes();
  };

  function scanRes(){
    var list = document.getElementById('__mirror_res_list__');
    var res = [];
    var seen = {};

    function add(url, type, label){
      if(!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return;
      var realUrl = url;
      try {
        if(url.indexOf('/api/browse?url=') > -1){
          realUrl = decodeURIComponent(url.split('/api/browse?url=')[1].split('&')[0]);
        }
        if(!realUrl.startsWith('http')) return;
        if(seen[realUrl]) return;
        seen[realUrl] = true;
        var fn = realUrl.split('/').pop().split('?')[0] || 'recurso';
        res.push({url: realUrl, type: type, label: label, filename: fn});
      } catch(e){}
    }

    document.querySelectorAll('img').forEach(function(img){
      add(img.src || img.dataset.src, 'image', img.alt || '');
    });
    document.querySelectorAll('a[href]').forEach(function(a){
      add(a.href, 'link', (a.textContent || '').trim().substring(0, 30));
    });
    document.querySelectorAll('video,source,audio').forEach(function(v){
      if(v.src) add(v.src, 'media', 'media');
    });
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){
      if(l.href) add(l.href, 'css', 'CSS');
    });
    document.querySelectorAll('script[src]').forEach(function(s){
      add(s.src, 'js', 'JS');
    });

    if(res.length === 0){
      list.innerHTML = '<p style="color:#666">No se encontraron recursos</p>';
      return;
    }

    var grouped = {};
    res.forEach(function(r){ (grouped[r.type] = grouped[r.type] || []).push(r); });

    var icons = {image:'🖼️',link:'🔗',media:'🎬',css:'🎨',js:'⚡'};
    var names = {image:'Imágenes',link:'Enlaces',media:'Media',css:'CSS',js:'JavaScript'};
    var colors = {image:'#22c55e',link:'#3b82f6',media:'#f59e0b',css:'#a855f7',js:'#6366f1'};

    var html = '<div style="margin-bottom:12px;color:#7c5cfc;font-weight:600;font-size:14px">Total: ' + res.length + ' recursos</div>';

    var downloadable = res.filter(function(r){
      return r.filename && r.filename.indexOf('.') > -1 && r.type !== 'link' && r.type !== 'js';
    });
    if(downloadable.length > 0){
      html += '<button onclick="__mirrorDLAll__()" style="width:100%;padding:8px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:600;margin-bottom:12px;font-size:12px">⬇️ Descargar ' + downloadable.length + ' archivos</button>';
    }

    for(var type in grouped){
      var items = grouped[type];
      html += '<div style="color:' + (colors[type]||'#888') + ';font-weight:600;margin:12px 0 5px;font-size:13px">' + (icons[type]||'📎') + ' ' + (names[type]||type) + ' (' + items.length + ')</div>';
      items.forEach(function(r){
        var isDL = r.type !== 'link' && r.type !== 'js' && r.filename && r.filename.indexOf('.') > -1;
        html += '<div style="background:#2a2a3e;border-radius:6px;padding:6px 8px;margin-bottom:3px;display:flex;gap:4px;align-items:center">';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;font-size:11px" title="' + r.url.replace(/"/g,'&quot;') + '">' + r.filename.substring(0,28) + '</span>';
        if(isDL){
          html += '<button onclick="dlOne(\\''+r.url.replace(/'/g,"\\\\'")+'\\',\\''+r.filename.replace(/'/g,"\\\\'")+'\\')" style="padding:2px 6px;border-radius:4px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:10px;flex-shrink:0">⬇</button>';
        }
        html += '<button onclick="window.open(\\''+r.url.replace(/'/g,"\\\\'")+'\\')" style="padding:2px 6px;border-radius:4px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:10px;flex-shrink:0">🔗</button>';
        html += '</div>';
      });
    }

    list.innerHTML = html;
    window.__mirrorDLAll__ = function(){
      downloadable.forEach(function(r, i){
        setTimeout(function(){ dlOne(r.url, r.filename); }, i * 800);
      });
    };
  }

  window.dlOne = function(url, filename){
    var a = document.createElement('a');
    a.href = '/api/download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent(filename);
    a.click();
  };

  setTimeout(function(){ try{ scanRes(); }catch(e){} }, 1500);
})();
</script>
<!-- ═══ FIN TOOLBAR ═══ -->
`;

  if (html.includes("</body>")) {
    html = html.replace("</body>", toolbar + "\n</body>");
  } else if (html.includes("</BODY>")) {
    html = html.replace("</BODY>", toolbar + "\n</BODY>");
  } else {
    html = html + toolbar;
  }

  return html;
}
