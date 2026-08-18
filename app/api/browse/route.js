import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   /api/browse — FULL WEB PROXY (v7)
   
   Proxy completo que permite:
   - Iniciar sesión en cualquier sitio
   - Navegar normalmente (click en links funciona)
   - JavaScript funciona (interceptamos fetch/XHR)
   - Cookies se mantienen
   - Barra flotante para descargar cualquier imagen/archivo
   
   Cómo funciona:
   1. Todo HTML → reescribir URLs + inyectar interceptor JS + toolbar
   2. Todo CSS → reescribir url()
   3. Todo lo demás → proxy directo
   4. JS interceptor → captura fetch/XHR y los redirige por el proxy
   5. Cookies → se guardan en localStorage del cliente y se envían con cada request
   ═══════════════════════════════════════════════════════════════ */

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
  "Sec-Ch-Ua": '"Chromium";v="122","Not(A:Brand";v="24","Google Chrome";v="122"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
};

const IMAGE_EXTS = new Set([".jpg",".jpeg",".png",".gif",".webp",".svg",".bmp",".ico",".tiff",".avif"]);
const BINARY_EXTS = new Set([".pdf",".zip",".rar",".7z",".mp.4",".mp3",".wav",".avi",".mkv",".mov",".webm",".m4a",".flac",".ogg",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".exe",".dmg",".iso",".apk",".epub",".mobi"]);

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

export async function GET(req) {
  const targetUrl = req.nextUrl.searchParams.get("url");
  if (!targetUrl) return NextResponse.json({ error: "Falta ?url=" }, { status: 400 });
  try { new URL(targetUrl); } catch { return NextResponse.json({ error: "URL inválida" }, { status: 400 }); }

  try {
    // Build headers — include forwarded cookies
    const reqHeaders = { ...BROWSER_HEADERS };
    
    // Get cookies from the client (sent as X-Proxy-Cookies header)
    const proxyCookies = req.headers.get("x-proxy-cookies") || "";
    if (proxyCookies) {
      reqHeaders["Cookie"] = proxyCookies;
    }

    // Set appropriate Accept header based on what the client expects
    const acceptHeader = req.headers.get("x-proxy-accept") || "";
    if (acceptHeader) {
      reqHeaders["Accept"] = acceptHeader;
    } else {
      reqHeaders["Accept"] = "*/*";
    }

    // Add Referer
    const referer = req.headers.get("x-proxy-referer") || "";
    if (referer) {
      reqHeaders["Referer"] = referer;
    } else {
      try {
        reqHeaders["Referer"] = new URL(targetUrl).origin + "/";
      } catch {}
    }

    // Origin
    try {
      reqHeaders["Origin"] = new URL(targetUrl).origin;
    } catch {}

    const resp = await fetch(targetUrl, {
      headers: reqHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    const contentType = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;

    // Collect Set-Cookie headers to forward to client
    const setCookies = [];
    for (const [key, value] of resp.headers.entries()) {
      if (key.toLowerCase() === "set-cookie") {
        setCookies.push(value);
      }
    }

    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "X-Proxy-Cookies, X-Proxy-Accept, X-Proxy-Referer",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "X-Proxy-Url": finalUrl,
    };

    // Forward Set-Cookie as X-Set-Cookie (client JS will handle them)
    if (setCookies.length > 0) {
      responseHeaders["X-Set-Cookie"] = JSON.stringify(setCookies);
    }

    // ── HTML → rewrite + inject interceptor ──
    if (contentType.includes("text/html") || contentType.includes("text/xhtml")) {
      let html = await resp.text();
      html = rewriteHtmlUrls(html, finalUrl);
      html = injectInterceptorAndToolbar(html, finalUrl, targetUrl);
      responseHeaders["Content-Type"] = "text/html; charset=utf-8";
      return new NextResponse(html, { status: 200, headers: responseHeaders });
    }

    // ── CSS → rewrite url() ──
    if (contentType.includes("text/css")) {
      let css = await resp.text();
      css = rewriteCssUrls(css, finalUrl);
      responseHeaders["Content-Type"] = "text/css";
      responseHeaders["Cache-Control"] = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
      return new NextResponse(css, { status: 200, headers: responseHeaders });
    }

    // ── JavaScript → rewrite URLs inside ──
    if (contentType.includes("javascript")) {
      let js = await resp.text();
      js = rewriteJsUrls(js, finalUrl);
      responseHeaders["Content-Type"] = contentType;
      responseHeaders["Cache-Control"] = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
      return new NextResponse(js, { status: 200, headers: responseHeaders });
    }

    // ── Everything else → pass through ──
    const body = await resp.arrayBuffer();
    responseHeaders["Content-Type"] = contentType || "application/octet-stream";
    responseHeaders["Cache-Control"] = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
    
    if (isBinaryDownload(targetUrl)) {
      responseHeaders["Content-Disposition"] = `attachment; filename="${filenameFromUrl(targetUrl)}"`;
    }

    return new NextResponse(body, { status: 200, headers: responseHeaders });
  } catch (e) {
    let msg = e.message;
    if (msg.includes("timeout")) msg = "El sitio tardó demasiado";
    if (msg.includes("ENOTFOUND")) msg = "El dominio no existe";
    return errorPage(0, msg);
  }
}

// Handle POST requests (forms, API calls)
export async function POST(req) {
  const targetUrl = req.nextUrl.searchParams.get("url");
  if (!targetUrl) return NextResponse.json({ error: "Falta ?url=" }, { status: 400 });

  try {
    const reqHeaders = { ...BROWSER_HEADERS, "Accept": "*/*" };
    
    const proxyCookies = req.headers.get("x-proxy-cookies") || "";
    if (proxyCookies) reqHeaders["Cookie"] = proxyCookies;
    
    const referer = req.headers.get("x-proxy-referer") || "";
    if (referer) reqHeaders["Referer"] = referer;
    else { try { reqHeaders["Referer"] = new URL(targetUrl).origin + "/"; } catch {} }
    
    try { reqHeaders["Origin"] = new URL(targetUrl).origin; } catch {}

    // Forward content type
    const ct = req.headers.get("content-type") || "";
    if (ct) reqHeaders["Content-Type"] = ct;

    const body = await req.arrayBuffer();

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: reqHeaders,
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });

    const respCt = resp.headers.get("content-type") || "";
    const finalUrl = resp.url || targetUrl;
    const respBody = await resp.arrayBuffer();

    const responseHeaders = {
      "Content-Type": respCt || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "X-Proxy-Cookies, X-Proxy-Accept, X-Proxy-Referer",
      "X-Proxy-Url": finalUrl,
    };

    // Capture set-cookie
    const setCookies = [];
    for (const [key, value] of resp.headers.entries()) {
      if (key.toLowerCase() === "set-cookie") setCookies.push(value);
    }
    if (setCookies.length > 0) responseHeaders["X-Set-Cookie"] = JSON.stringify(setCookies);

    return new NextResponse(respBody, { status: resp.status, headers: responseHeaders });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Handle OPTIONS (CORS preflight)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "X-Proxy-Cookies, X-Proxy-Accept, X-Proxy-Referer, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    },
  });
}

/* ═══════════════════════════════════════════════════
   URL REWRITING
   ═══════════════════════════════════════════════════ */

function rewriteHtmlUrls(html, baseUrl) {
  // href
  html = html.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  // src
  html = html.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  // srcset
  html = html.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, srcset, post) => {
    const r = srcset.split(",").map(p => { const t=p.trim(); const s=t.indexOf(" "); return s===-1?rw(t,baseUrl):rw(t.substring(0,s),baseUrl)+t.substring(s); }).join(", ");
    return `${pre}${r}${post}`;
  });
  // data-* lazy
  for (const a of ["data-src","data-lazy-src","data-original","data-lazy","data-image"]) {
    html = html.replace(new RegExp(`(${a}\\s*=\\s*["'])([^"']+)(["'])`,"gi"), (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  }
  // CSS url()
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, url) => {
    if (url.startsWith("data:")||url.startsWith("#")||url.startsWith("blob:")) return m;
    try { return `url(/api/browse?url=${encodeURIComponent(new URL(url,baseUrl).href)})`; } catch { return m; }
  });
  // action, poster
  html = html.replace(/(action\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  html = html.replace(/(poster\s*=\s*["'])([^"']+)(["'])/gi, (m, pre, url, post) => `${pre}${rw(url,baseUrl)}${post}`);
  return html;
}

function rewriteCssUrls(css, baseUrl) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, url) => {
    if (url.startsWith("data:")||url.startsWith("#")||url.startsWith("blob:")) return m;
    try { return `url(/api/browse?url=${encodeURIComponent(new URL(url,baseUrl).href)})`; } catch { return m; }
  });
}

function rewriteJsUrls(js, baseUrl) {
  // Rewrite string URLs in JS that point to the target domain
  // This is aggressive but necessary for SPAs
  try {
    const origin = new URL(baseUrl).origin;
    // Replace absolute URLs to the origin
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    js = js.replace(new RegExp(`(["'\\\`])(${escaped})(/[^"'\\\`\\s]*)`, "g"), (m, quote, orig, path) => {
      try {
        const full = orig + path;
        return `${quote}/api/browse?url=${encodeURIComponent(full)}`;
      } catch { return m; }
    });
  } catch {}
  return js;
}

function rw(url, baseUrl) {
  if (!url||url.startsWith("#")||url.startsWith("javascript:")||url.startsWith("mailto:")||url.startsWith("data:")||url.startsWith("blob:")||url.startsWith("about:")||url.startsWith("/api/browse")) return url;
  try { return `/api/browse?url=${encodeURIComponent(new URL(url,baseUrl).href)}`; } catch { return url; }
}

/* ═══════════════════════════════════════════════@══
   INTERCEPTOR + TOOLBAR INJECTION
   
   This script:
   1. Overrides fetch() to route through proxy
   2. Overrides XMLHttpRequest to route through proxy  
   3. Overrides History API (pushState/replaceState)
   4. Manages cookies (stores in localStorage, sends as header)
   5. Intercepts Set-Cookie from responses
   6. Adds floating toolbar with download buttons
   ═══════════════════════════════════════════════════ */

function injectInterceptorAndToolbar(html, currentUrl, originalUrl) {
  const esc = originalUrl.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/"/g,"\\\"");
  const escCurrent = currentUrl.replace(/\\/g,"\\\\").replace(/'/g,"\\'");

  const injection = `
<!-- ═══ PROXY INTERCEPTOR + TOOLBAR ═══ -->
<script>
(function(){
  var PROXY_BASE = '/api/browse';
  var CURRENT_ORIGIN = '${escCurrent}'.split('/').slice(0,3).join('/');
  
  // ── COOKIE JAR ──
  // Store cookies per domain in localStorage
  var COOKIE_KEY = '__proxy_cookies__';
  function getCookieJar() {
    try { return JSON.parse(localStorage.getItem(COOKIE_KEY) || '{}'); } catch { return {}; }
  }
  function saveCookieJar(jar) {
    try { localStorage.setItem(COOKIE_KEY, JSON.stringify(jar)); } catch {}
  }
  function getCookiesForUrl(url) {
    try {
      var jar = getCookieJar();
      var domain = new URL(url).hostname;
      var cookies = [];
      for (var d in jar) {
        if (domain === d || domain.endsWith('.' + d)) {
          for (var name in jar[d]) {
            cookies.push(name + '=' + jar[d][name]);
          }
        }
      }
      return cookies.join('; ');
    } catch { return ''; }
  }
  function storeSetCookies(url, setCookieHeader) {
    try {
      var jar = getCookieJar();
      var domain = new URL(url).hostname;
      if (!jar[domain]) jar[domain] = {};
      var cookies = JSON.parse(setCookieHeader);
      cookies.forEach(function(c) {
        var parts = c.split(';')[0].split('=');
        if (parts.length >= 2) {
          jar[domain][parts[0].trim()] = parts.slice(1).join('=').trim();
        }
      });
      saveCookieJar(jar);
    } catch {}
  }
  
  // Read initial cookies from meta tag
  window.__proxyGetCookies = function(url) { return getCookiesForUrl(url); };
  window.__proxyStoreCookies = function(url, header) { storeSetCookies(url, header); };

  // ── INTERCEPT FETCH ──
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else if (input instanceof Request) url = input.url;
    
    if (url && !url.startsWith(PROXY_BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        var full = new URL(url, location.href).href;
        // Check if this is already proxied
        if (full.indexOf(PROXY_BASE + '?url=') === -1) {
          var proxyUrl = PROXY_BASE + '?url=' + encodeURIComponent(full);
          init = init || {};
          init.headers = init.headers || {};
          // Add proxy cookies
          var cookies = getCookiesForUrl(full);
          if (cookies) init.headers['X-Proxy-Cookies'] = cookies;
          // Add referer
          try { init.headers['X-Proxy-Referer'] = new URL(location.href).searchParams.get('url') || location.href; } catch {}
          // Add accept
          if (!init.headers['Accept']) init.headers['X-Proxy-Accept'] = '*/*';
          
          return origFetch(proxyUrl, init).then(function(resp) {
            // Capture set-cookie
            var sc = resp.headers.get('X-Set-Cookie');
            if (sc) storeSetCookies(full, sc);
            return resp;
          });
        }
      } catch(e) {}
    }
    return origFetch(input, init);
  };

  // ── INTERCEPT XHR ──
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;
  var origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__proxyUrl = url;
    this.__proxyMethod = method;
    if (url && !url.startsWith(PROXY_BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        var full = new URL(url, location.href).href;
        if (full.indexOf(PROXY_BASE + '?url=') === -1) {
          var proxyUrl = PROXY_BASE + '?url=' + encodeURIComponent(full);
          this.__proxyTargetUrl = full;
          return origXHROpen.call(this, method, proxyUrl);
        }
      } catch {}
    }
    return origXHROpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__proxyTargetUrl) {
      var cookies = getCookiesForUrl(this.__proxyTargetUrl);
      if (cookies) origXHRSetHeader.call(this, 'X-Proxy-Cookies', cookies);
      try { origXHRSetHeader.call(this, 'X-Proxy-Referer', new URL(location.href).searchParams.get('url') || location.href); } catch {}
      origXHRSetHeader.call(this, 'X-Proxy-Accept', '*/*');
    }
    
    // Capture set-cookie from response
    var self = this;
    var origOnReady = this.onreadystatechange;
    this.onreadystatechange = function() {
      if (self.readyState === 4 && self.__proxyTargetUrl) {
        try {
          var sc = self.getResponseHeader('X-Set-Cookie');
          if (sc) storeSetCookies(self.__proxyTargetUrl, sc);
        } catch {}
      }
      if (origOnReady) return origOnReady.apply(this, arguments);
    };
    
    return origXHRSend.apply(this, arguments);
  };

  // ── INTERCEPT HISTORY API ──
  var origPush = history.pushState;
  history.pushState = function(state, title, url) {
    if (url && !url.startsWith(PROXY_BASE)) {
      try {
        var full = new URL(url, location.href).href;
        url = PROXY_BASE + '?url=' + encodeURIComponent(full);
      } catch {}
    }
    return origPush.apply(history, arguments);
  };
  var origReplace = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (url && !url.startsWith(PROXY_BASE)) {
      try {
        var full = new URL(url, location.href).href;
        url = PROXY_BASE + '?url=' + encodeURIComponent(full);
      } catch {}
    }
    return origReplace.apply(history, arguments);
  };

  // ── INTERCEPT WINDOW.OPEN ──
  var origOpen = window.open;
  window.open = function(url) {
    if (url && !url.startsWith(PROXY_BASE) && !url.startsWith('data:')) {
      try {
        var full = new URL(url, location.href).href;
        return origOpen(PROXY_BASE + '?url=' + encodeURIComponent(full));
      } catch {}
    }
    return origOpen.apply(window, arguments);
  };

  // ── INTERCEPT DOCUMENT.COOKIE ──
  // This is tricky but essential for login to work
  var origCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
  if (origCookieDesc) {
    Object.defineProperty(document, 'cookie', {
      get: function() {
        try {
          var jar = getCookieJar();
          var domain = new URL(location.href).searchParams.get('url');
          if (domain) domain = new URL(domain).hostname;
          else domain = location.hostname;
          var cookies = [];
          for (var d in jar) {
            if (domain === d || domain.endsWith('.' + d)) {
              for (var name in jar[d]) {
                cookies.push(name + '=' + jar[d][name]);
              }
            }
          }
          return cookies.join('; ');
        } catch { return origCookieDesc.get.call(document); }
      },
      set: function(val) {
        try {
          var jar = getCookieJar();
          var urlParam = new URL(location.href).searchParams.get('url');
          var domain = urlParam ? new URL(urlParam).hostname : location.hostname;
          if (!jar[domain]) jar[domain] = {};
          var parts = val.split(';')[0].split('=');
          if (parts.length >= 2) {
            jar[domain][parts[0].trim()] = parts.slice(1).join('=').trim();
            saveCookieJar(jar);
          }
        } catch {}
        try { return origCookieDesc.set.call(document, val); } catch {}
      }
    });
  }
})();
</script>

<!-- ═══ TOOLBAR ═══ -->
<div id="__mt__" style="position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:linear-gradient(135deg,var(--panel),#0a2a1a)!important;border-bottom:2px solid #22c55e!important;padding:8px 15px!important;display:flex!important;align-items:center!important;gap:10px!important;font-family:'Segoe UI',sans-serif!important;font-size:13px!important;color:var(--text)!important;box-shadow:0 4px 20px rgba(0,0,0,.5)!important">
  <div style="font-weight:700!important;color:#22c55e!important;font-size:14px!important;flex-shrink:0!important">🪞 ESPEJO</div>
  <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text3);font-size:12px" title="${esc}">${originalUrl.length>60?originalUrl.substring(0,60)+"...":originalUrl}</div>
  <button onclick="__mirrorScan()" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:#22c55e!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;flex-shrink:0!important">⬇️ Descargar</button>
  <button onclick="location.href='/'" style="padding:5px 12px!important;border-radius:6px!important;border:none!important;background:var(--text5)!important;color:#fff!important;cursor:pointer!important;font-size:12px!important;font-weight:600!important;flex-shrink:0!important">🏠</button>
</div>
<div style="height:40px!important"></div>

<!-- Download panel -->
<div id="__mdp__" style="position:fixed!important;top:40px!important;right:0!important;bottom:0!important;width:380px!important;z-index:2147483646!important;background:var(--panel)!important;border-left:2px solid #22c55e!important;display:none!important;overflow-y:auto!important;padding:15px!important;font-family:'Segoe UI',sans-serif!important;color:var(--text)!important;box-shadow:-5px 0 30px rgba(0,0,0,.5)!important">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
    <h3 style="margin:0;color:#22c55e;font-size:16px">⬇️ Descargar recursos</h3>
    <button onclick="document.getElementById('__mdp__').style.display='none'" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px">✕</button>
  </div>
  <div id="__mdl__" style="font-size:12px;color:var(--text3)">Escaneando página...</div>
</div>

<script>
(function(){
  try { document.body.style.paddingTop = '40px'; } catch(e){}
  
  // ── SCAN & DOWNLOAD ──
  window.__mirrorScan = function() {
    var panel = document.getElementById('__mdp__');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') doScan();
  };

  function doScan() {
    var list = document.getElementById('__mdl__');
    var resources = [];
    var seen = {};

    function add(url, type, label) {
      if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return;
      // Extract real URL from proxy
      var real = url;
      try {
        if (url.indexOf('/api/browse?url=') > -1) {
          real = decodeURIComponent(url.split('/api/browse?url=')[1].split('&')[0]);
        }
      } catch {}
      if (!real.startsWith('http') || seen[real]) return;
      seen[real] = 1;
      var fn = real.split('/').pop().split('?')[0] || 'recurso';
      resources.push({ url: real, proxyUrl: url, type: type, label: label, filename: fn });
    }

    // Images
    document.querySelectorAll('img').forEach(function(img) {
      add(img.src || img.dataset.src, 'image', img.alt || 'imagen');
    });
    // Background images
    document.querySelectorAll('[style*="url("]').forEach(function(el) {
      var m = (el.style.backgroundImage || '').match(/url\\(["']?(.*?)["']?\\)/);
      if (m && m[1]) add(m[1], 'image', 'fondo CSS');
    });
    // Videos
    document.querySelectorAll('video,source,audio').forEach(function(v) { if (v.src) add(v.src, 'media', 'media'); });
    // Downloadable links
    document.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.href;
      var fn = href.split('/').pop().split('?')[0] || '';
      if (fn && fn.indexOf('.') > -1 && fn.length < 100) {
        add(href, 'file', fn);
      }
    });

    if (resources.length === 0) {
      list.innerHTML = '<p style="color:var(--text4)">No se encontraron recursos descargables.</p><p style="color:var(--text5);font-size:0.9em;margin-top:10px">Tip: navegá a una página con imágenes y presioná ⬇️ de nuevo.</p>';
      return;
    }

    var dl = resources.filter(function(r) { return r.type !== 'link'; });
    var html = '<div style="color:#22c55e;font-weight:600;margin-bottom:10px">' + resources.length + ' recursos encontrados</div>';
    if (dl.length > 1) {
      html += '<button onclick="__dlAll()" style="width:100%;padding:8px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-weight:600;margin-bottom:12px;font-size:12px">⬇️ Descargar ' + dl.length + ' archivos</button>';
    }

    var grouped = {};
    resources.forEach(function(r) { (grouped[r.type] = grouped[r.type] || []).push(r); });
    var icons = { image: '🖼️', media: '🎬', file: '📎' };
    var names = { image: 'Imágenes', media: 'Media', file: 'Archivos' };
    var colors = { image: '#22c55e', media: '#f59e0b', file: '#3b82f6' };

    for (var type in grouped) {
      var items = grouped[type];
      html += '<div style="color:' + (colors[type]||'var(--text3)') + ';font-weight:600;margin:12px 0 5px;font-size:13px">' + (icons[type]||'📎') + ' ' + (names[type]||type) + ' (' + items.length + ')</div>';
      items.forEach(function(r) {
        html += '<div style="background:var(--border);border-radius:6px;padding:8px;margin-bottom:4px;display:flex;gap:6px;align-items:center">';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);font-size:11px" title="' + r.url.replace(/"/g,'&quot;') + '">' + r.filename.substring(0,32) + '</span>';
        html += '<a href="/api/download?url=' + encodeURIComponent(r.url) + '&filename=' + encodeURIComponent(r.filename) + '" download style="padding:3px 8px;border-radius:4px;background:#22c55e;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0;font-weight:600">⬇</a>';
        html += '<a href="' + r.url + '" target="_blank" style="padding:3px 8px;border-radius:4px;background:#3b82f6;color:#fff;font-size:10px;text-decoration:none;flex-shrink:0;font-weight:600">🔗</a>';
        html += '</div>';
      });
    }

    list.innerHTML = html;
    window.__dlAll = function() {
      dl.forEach(function(r, i) {
        setTimeout(function() {
          var a = document.createElement('a');
          a.href = '/api/download?url=' + encodeURIComponent(r.url) + '&filename=' + encodeURIComponent(r.filename);
          a.click();
        }, i * 600);
      });
    };
  }

  // Auto-scan periodically
  var lastScanCount = 0;
  setInterval(function() {
    var imgs = document.querySelectorAll('img');
    if (imgs.length !== lastScanCount) {
      lastScanCount = imgs.length;
      var panel = document.getElementById('__mdp__');
      if (panel && panel.style.display === 'block') doScan();
    }
  }, 3000);
})();
</script>
<!-- ═══ END INJECTION ═══ -->
`;

  if (html.includes("</head>")) {
    // Inject interceptor ASAP in <head>
    const headScript = injection.split('<!-- ═══ TOOLBAR')[0];
    html = html.replace("</head>", headScript + "\n</head>");
    // Inject toolbar before </body>
    const toolbar = '<!-- ═══ TOOLBAR ═══ -->' + injection.split('<!-- ═══ TOOLBAR ═══ -->')[1];
    if (html.includes("</body>")) {
      html = html.replace("</body>", toolbar + "\n</body>");
    } else {
      html += toolbar;
    }
  } else if (html.includes("</body>")) {
    html = html.replace("</body>", injection + "\n</body>");
  } else {
    html += injection;
  }

  return html;
}

function errorPage(status, msg) {
  msg = msg || `Error ${status}`;
  return new NextResponse(`<!DOCTYPE html><html><body style="background:#0f0f1a;color:var(--text);font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:3em;margin-bottom:15px">\u274c</div><h1>Error</h1><p style="color:var(--text3);margin-top:10px;line-height:1.5">${msg}</p><a href="/" style="color:#22c55e;margin-top:20px;display:inline-block">← Volver</a></div></body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
}
