import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════
   /api/spotify — Spotify Web API Proxy
   
   Handles:
   - GET access token (client credentials)
   - Search albums/artists/tracks
   - Get album details with all images
   - Get new releases
   - Get artist details
   
   Credentials come from environment variables:
   - SPOTIFY_CLIENT_ID
   - SPOTIFY_CLIENT_SECRET
   
   Or from query params for setup:
   - ?client_id=xxx&client_secret=yyy
   ═══════════════════════════════════════════════════ */

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

// Token cache (lives for ~1 hour)
let tokenCache = { token: "", expires: 0 };

async function getAccessToken(clientId, clientSecret) {
  // Check cache
  if (tokenCache.token && Date.now() < tokenCache.expires) {
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

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Spotify auth failed: ${resp.status} - ${err}`);
  }

  const data = await resp.json();
  tokenCache = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000, // 60s buffer
  };
  return data.access_token;
}

function getCredentials(req) {
  // Try env vars first, then query params
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
      error: "Faltan credenciales de Spotify",
      setup: true,
      message: "Necesitás crear una app en developer.spotify.com y agregar tu Client ID y Client Secret",
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

    switch (action) {
      case "search": {
        if (!query) return NextResponse.json({ error: "Falta parámetro ?q=" }, { status: 400 });
        const type = req.nextUrl.searchParams.get("type") || "album,artist";
        const resp = await fetch(`${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&offset=${offset}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "album": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/albums/${id}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "artist": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/artists/${id}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "artist-albums": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/artists/${id}/albums?limit=${limit}&offset=${offset}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "new-releases": {
        const resp = await fetch(`${SPOTIFY_API_BASE}/browse/new-releases?limit=${limit}&offset=${offset}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "categories": {
        const resp = await fetch(`${SPOTIFY_API_BASE}/browse/categories?limit=${limit}&offset=${offset}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "category-playlists": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/browse/categories/${id}/playlists?limit=${limit}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "playlist": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/playlists/${id}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      case "track": {
        if (!id) return NextResponse.json({ error: "Falta parámetro ?id=" }, { status: 400 });
        const resp = await fetch(`${SPOTIFY_API_BASE}/tracks/${id}`, { headers });
        const data = await resp.json();
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json({ error: `Acción "${action}" no válida` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
