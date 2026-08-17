import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   API /api/browse — PROXY WEB COMPLETO
   
   Este es el cerebro. Recibe una URL, fetch el HTML completo,
   reescribe TODOS los links para que pasen por nuestro proxy,
   e inyecta una barra flotante con botones de descarga.
   
   Así el usuario puede NAVEGAR dentro del espejo y 
   descargar cualquier cosa con un click.
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

// Extensiones que se pueden descargar
const DOWNLOADABLE_EXTS = new Set([
  ".pdf", ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
  ".mp4", ".mp3", ".wav", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm", ".m4a", ".aac", ".flac", ".ogg",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".exe", ".dmg", ".iso", ".apk", ".deb", ".rpm",
  ".epub", ".mobi", ".cbz", ".cbr",
  ".psd", ".ai", ".sketch", ".fig",
  ".ttf", ".otf", ".woff", ".woff2",
  ".sql", ".db", ".sqlite",
  ".torrent",
]);

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".tif", ".avif",
]);

function isDownloadable(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    if (dot === -1) return false;
    const ext = path.substring(dot);
    return DOWNLOADABLE_EXTS.has(ext) || IMAGE_EXTS.has(ext);
  } catch {
    return false;
  }
}

function isImage(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    if (dot === -1) return false;
    return IMAGE_EXTS.has(path.substring(dot));
  } catch {
    return false;
  }
}

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

export async function GET(req) {
  const targetUrl = req.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Falta parámetro ?url=" }, { status: 400 });
  }

  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      return new NextResponse(
        `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
          <div style="text-align:center">
            <h1>❌ Error ${resp.status}</h1>
            <p style="color:#888;margin-top:10px">El sitio respondió con error ${resp.status}</p>
            <p style="color:#666;margin-top:5px">Algunos sitios bloquean peticiones de servidores</p>
            <a href="/" style="color:#7c5cfc;margin-top:20px;display:inline-block">← Volver</a>
          </div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;

    // ── Si NO es HTML, servir como proxy directo ──
    if (!contentType.includes("text/html") && !contentType.includes("text/xhtml")) {
      const body = await resp.arrayBuffer();
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
          ...(isDownloadable(targetUrl)
            ? { "Content-Disposition": `attachment; filename="${filenameFromUrl(targetUrl)}"` }
            : {}),
        },
      });
    }

    // ── Es HTML: reescribir TODO ──
    let html = await resp.text();

    // 1. Reescribir URLs para que pasen por nuestro proxy
    html = rewriteUrls(html, finalUrl);

    // 2. Inyectar la barra flotante con herramientas
    html = injectToolbar(html, finalUrl, targetUrl);

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    let msg = e.message;
    if (msg.includes("timeout")) msg = "El sitio tardó demasiado en responder";
    if (msg.includes("ENOTFOUND")) msg = "El dominio no existe";

    return new NextResponse(
      `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center">
          <h1>❌ Error</h1>
          <p style="color:#888;margin-top:10px">${msg}</p>
          <a href="/" style="color:#7c5cfc;margin-top:20px;display:inline-block">← Volver</a>
        </div>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }
}

/* ═══════════════════════════════════════════════════
   REESCRIBIR URLs
   Cambia todos los links para que pasen por /api/browse?url=
   ═══════════════════════════════════════════════════ */

function rewriteUrls(html, baseUrl) {
  // href="..." → /api/browse?url=...
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    const rewritten = rewriteUrl(url, baseUrl);
    return `${pre}${rewritten}${post}`;
  });

  // src="..." → /api/browse?url=... (para imágenes, scripts, etc.)
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    const rewritten = rewriteUrl(url, baseUrl);
    return `${pre}${rewritten}${post}`;
  });

  // srcset="img1 1x, img2 2x"
  html = html.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, srcset, post) => {
    const rewritten = srcset
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.indexOf(" ");
        if (spaceIdx === -1) {
          return rewriteUrl(trimmed, baseUrl);
        }
        const url = trimmed.substring(0, spaceIdx);
        const descriptor = trimmed.substring(spaceIdx);
        return rewriteUrl(url, baseUrl) + descriptor;
      })
      .join(", ");
    return `${pre}${rewritten}${post}`;
  });

  // data-src, data-lazy-src, etc. (lazy loading)
  const dataAttrs = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-image", "data-zoom-image"];
  for (const attr of dataAttrs) {
    const regex = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, "gi");
    html = html.replace(regex, (match, pre, url, post) => {
      return `${pre}${rewriteUrl(url, baseUrl)}${post}`;
    });
  }

  // url() en CSS inline
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
    return `url(${rewriteUrl(url, baseUrl)})`;
  });

  // action="..." en formularios
  html = html.replace(/(action\s*=\s*["'])([^"']+)(["'])/gi, (match, pre, url, post) => {
    return `${pre}${rewriteUrl(url, baseUrl)}${post}`;
  });

  return html;
}

function rewriteUrl(url, baseUrl) {
  // No tocar anchors, javascript:, mailto:, data:, ya-proxy
  if (!url || url.startsWith("#") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("data:") || url.startsWith("/api/browse")) {
    return url;
  }

  try {
    // Resolver URL relativa
    const full = new URL(url, baseUrl).href;

    // Si ya es nuestro proxy, no reescribir
    if (full.includes("/api/browse")) return full;

    // Pasar por nuestro proxy
    return `/api/browse?url=${encodeURIComponent(full)}`;
  } catch {
    return url;
  }
}

/* ═══════════════════════════════════════════════════
   INYECTAR BARRA FLOTANTE
   Agrega una barra en la parte de arriba con:
   - URL actual
   - Botón "Descargar esta página"
   - Botón "Ver recursos"
   - Botón "Volver al inicio"
   ═══════════════════════════════════════════════════ */

function injectToolbar(html, currentUrl, originalUrl) {
  const toolbar = `
<!-- ═══ ESPEJO TOOLBAR ═══ -->
<div id="__mirror_toolbar__" style="
  position:fixed; top:0; left:0; right:0; z-index:999999;
  background:linear-gradient(135deg,#1a1a2e,#2a1a3e);
  border-bottom:2px solid #7c5cfc;
  padding:8px 15px;
  display:flex; align-items:center; gap:10px;
  font-family:'Segoe UI',sans-serif; font-size:13px; color:#e0e0e0;
  box-shadow:0 2px 20px rgba(0,0,0,0.5);
">
  <div style="font-weight:700;color:#7c5cfc;font-size:14px">🪞 ESPEJO</div>
  <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888;max-width:400px" title="${originalUrl}">
    ${originalUrl.length > 60 ? originalUrl.substring(0, 60) + "..." : originalUrl}
  </div>
  <button onclick="__mirrorDownloadPage__()" style="padding:5px 12px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">
    ⬇️ Descargar página
  </button>
  <button onclick="__mirrorShowResources__()" style="padding:5px 12px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">
    📋 Recursos
  </button>
  <button onclick="location.href='/'" style="padding:5px 12px;border-radius:6px;border:none;background:#555;color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">
    🏠 Inicio
  </button>
</div>
<div style="height:42px"></div>

<!-- Panel de recursos (oculto por defecto) -->
<div id="__mirror_resources_panel__" style="
  position:fixed; top:42px; right:0; bottom:0; width:350px; z-index:999998;
  background:#1a1a2e; border-left:2px solid #7c5cfc;
  display:none; overflow-y:auto; padding:15px;
  font-family:'Segoe UI',sans-serif; color:#e0e0e0;
  box-shadow:-5px 0 30px rgba(0,0,0,0.5);
">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
    <h3 style="margin:0;color:#7c5cfc;font-size:16px">📋 Recursos de la página</h3>
    <button onclick="document.getElementById('__mirror_resources_panel__').style.display='none'" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px">✕</button>
  </div>
  <div id="__mirror_resource_list__" style="font-size:12px;color:#888">Buscando recursos...</div>
</div>

<script>
(function(){
  // Compensar el toolbar
  document.body.style.paddingTop = '42px';

  // Descargar esta página completa
  window.__mirrorDownloadPage__ = function(){
    const a = document.createElement('a');
    a.href = '/api/download?url=' + encodeURIComponent('${originalUrl}') + '&filename=' + encodeURIComponent(location.hostname + '.html');
    a.click();
  };

  // Mostrar/ocultar panel de recursos
  window.__mirrorShowResources__ = function(){
    const panel = document.getElementById('__mirror_resources_panel__');
    if(panel.style.display === 'none'){
      panel.style.display = 'block';
      scanResources();
    } else {
      panel.style.display = 'none';
    }
  };

  // Escanear todos los recursos de la página
  function scanResources(){
    const list = document.getElementById('__mirror_resource_list__');
    const resources = [];
    const seen = new Set();

    function add(url, type, label){
      try {
        // Extraer URL real de nuestro proxy
        let realUrl = url;
        if(url.includes('/api/browse?url=')){
          realUrl = decodeURIComponent(url.split('/api/browse?url=')[1].split('&')[0]);
        }
        if(!realUrl.startsWith('http')) return;
        if(seen.has(realUrl)) return;
        seen.add(realUrl);
        const filename = realUrl.split('/').pop().split('?')[0] || 'recurso';
        resources.push({url: realUrl, type, label, filename});
      } catch(e){}
    }

    // Imágenes
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset.src;
      if(src) add(src, 'image', img.alt || 'imagen');
    });

    // Links
    document.querySelectorAll('a[href]').forEach(a => {
      add(a.href, 'link', a.textContent.trim().substring(0, 40) || 'enlace');
    });

    // Videos
    document.querySelectorAll('video, source').forEach(v => {
      if(v.src) add(v.src, 'media', 'video/audio');
    });

    // Stylesheets
    document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
      if(l.href) add(l.href, 'style', 'CSS');
    });

    // Scripts
    document.querySelectorAll('script[src]').forEach(s => {
      add(s.src, 'script', 'JavaScript');
    });

    // Background images
    document.querySelectorAll('[style*="url("]').forEach(el => {
      const match = el.style.backgroundImage?.match(/url\\(["']?(.*?)["']?\\)/);
      if(match && match[1]) add(match[1], 'image', 'fondo CSS');
    });

    // Render
    if(resources.length === 0){
      list.innerHTML = '<p style="color:#666">No se encontraron recursos</p>';
      return;
    }

    const grouped = {image: [], link: [], media: [], style: [], script: []};
    resources.forEach(r => {
      (grouped[r.type] || (grouped[r.type] = [])).push(r);
    });

    const icons = {image:'🖼️',link:'🔗',media:'🎬',style:'🎨',script:'⚡'};
    const names = {image:'Imágenes',link:'Enlaces',media:'Media',style:'Estilos',script:'Scripts'};

    let html = '<div style="margin-bottom:10px;color:#7c5cfc;font-weight:600">Total: ' + resources.length + ' recursos</div>';
    html += '<button onclick="__mirrorDownloadAll__()" style="width:100%;padding:8px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:600;margin-bottom:12px;font-size:12px">⬇️ Descargar todo descargable</button>';

    for(const [type, items] of Object.entries(grouped)){
      if(items.length === 0) continue;
      html += '<div style="color:#7c5cfc;font-weight:600;margin:10px 0 5px">' + (icons[type]||'📎') + ' ' + (names[type]||type) + ' (' + items.length + ')</div>';
      items.forEach(r => {
        const isDL = r.filename && r.filename.includes('.');
        html += '<div style="background:#2a2a3e;border-radius:6px;padding:6px 8px;margin-bottom:4px;display:flex;gap:6px;align-items:center">';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc" title="' + r.url + '">' + r.filename.substring(0,30) + '</span>';
        if(isDL){
          html += '<button onclick="window.__dlOne__(\\''+r.url+'\\',\\''+r.filename+'\\')" style="padding:2px 8px;border-radius:4px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:10px;white-space:nowrap">⬇</button>';
        }
        html += '<button onclick="window.open(\\''+r.url+'\\')" style="padding:2px 8px;border-radius:4px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:10px;white-space:nowrap">🔗</button>';
        html += '</div>';
      });
    }

    list.innerHTML = html;

    // Guardar para download all
    window.__mirrorAllResources__ = resources.filter(r => r.filename && r.filename.includes('.'));
  }

  window.__dlOne__ = function(url, filename){
    const a = document.createElement('a');
    a.href = '/api/download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent(filename);
    a.click();
  };

  window.__mirrorDownloadAll__ = function(){
    if(!window.__mirrorAllResources__) return;
    window.__mirrorAllResources__.forEach((r, i) => {
      setTimeout(() => {
        window.__dlOne__(r.url, r.filename);
      }, i * 800);
    });
  };

  // Auto-scan al cargar
  setTimeout(scanResources, 1000);
})();
</script>
<!-- ═══ FIN ESPEJO TOOLBAR ═══ -->
`;

  // Insertar toolbar antes de </body> o al final
  if (html.includes("</body>")) {
    html = html.replace("</body>", toolbar + "\n</body>");
  } else {
    html = html + toolbar;
  }

  // Agregar <base> para URLs relativas (si no tiene)
  if (!html.includes("<base")) {
    const baseTag = `<base href="${currentUrl}">`;
    if (html.includes("<head>")) {
      html = html.replace("<head>", "<head>" + baseTag);
    } else if (html.includes("<HEAD>")) {
      html = html.replace("<HEAD>", "<HEAD>" + baseTag);
    }
  }

  return html;
}
