import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   /api/spotify — Spotify Web API Proxy (v2 — better error handling)
   ═══════════════════════════════════════════════════ */

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

let tokenCache = { token: "", expires: 0, clientId: "" };

async function getAccessToken(clientId, clientSecret) {
  // Check cache (invalidate if credentials changed)
  if (tokenCache.token && Date.now() < tokenCache.expires && tokenCache.clientId === clientId) {
    return tokenCache.token;
  }

  const resp = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });

  const text = await resp.text();
  
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Spotify respondió con error ${resp.status}. Verificá que tu Client ID y Client Secret sean correctos.`);
  }

  if (!resp.ok) {
    const msg = data.error_description || data.error || `Error ${resp.status}`;
    throw new Error(msg);
  }

  if (!data.access_token) {
    throw new Error("No se recibió token de acceso. Verificá tus credenciales.");
  }

  tokenCache = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
    clientId: clientId,
  };
  return data.access_token;
}

function getCredentials(req) {
  let clientId = process.env.SPOTIFY_CLIENT_ID || "";
  let clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    clientId = req.nextUrl.searchParams.get("client_id") || "";
    clientSecret = req.nextUrl.searchParams.get("client_secret") || "";
  }
  return { clientId, clientSecret };
}

export async function GET(req) {
  const { clientId, clientSecret } = getCredentials(req);

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      error: "Faltan credenciales. Necesitás crear una app en developer.spotify.com",
      setup: true,
    }, { status: 400 });
  }

  const action = req.nextUrl.searchParams.get("action") || "search";
  const query = req.nextUrl.searchParams.get("q") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const headers = { "Authorization": `Bearer ${token}` };

    let apiUrl = "";

    switch (action) {
      case "search":
        if (!query) return NextResponse.json({ error: "Falta ?q=" }, { status: 400 });
        const type = req.nextUrl.searchParams.get("type") || "album,artist";
        apiUrl = `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&offset=${offset}`;
        break;
      case "album":
        if (!id) return NextResponse.json({ error: "Falta ?id=" }, { status: 400 });
        apiUrl = `${SPOTIFY_API_BASE}/albums/${id}`;
        break;
      case "artist":
        if (!id) return NextResponse.json({ error: "Falta ?id=" }, { status: 400 });
        apiUrl = `${SPOTIFY_API_BASE}/artists/${id}`;
        break;
      case "artist-albums":
        if (!id) return NextResponse.json({ error: "Falta ?id=" }, { status: 400 });
        apiUrl = `${SPOTIFY_API_BASE}/artists/${id}/albums?limit=${limit}&offset=${offset}`;
        break;
      case "new-releases":
        apiUrl = `${SPOTIFY_API_BASE}/browse/new-releases?limit=${limit}&offset=${offset}`;
        break;
      case "playlist":
        if (!id) return NextResponse.json({ error: "Falta ?id=" }, { status: 400 });
        apiUrl = `${SPOTIFY_API_BASE}/playlists/${id}`;
        break;
      default:
        return NextResponse.json({ error: `Acción "${action}" no válida` }, { status: 400 });
    }

    const resp = await fetch(apiUrl, { headers });
    const text = await resp.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: `Spotify API respondió con error ${resp.status}. Intentá de nuevo.` }, { status: resp.status });
    }

    if (!resp.ok) {
      const msg = data.error?.message || data.message || `Spotify error ${resp.status}`;
      return NextResponse.json({ error: msg }, { status: resp.status });
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
