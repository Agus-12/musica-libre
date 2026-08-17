import { NextRequest, NextResponse } from "next/server";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
let tokenCache = { token: "", expires: 0, clientId: "" };

async function getAccessToken(clientId, clientSecret) {
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
  try { data = JSON.parse(text); } catch { throw new Error("Spotify respondió con error " + resp.status + ". ¿Credenciales correctas?"); }
  if (!resp.ok) {
    if (data.error === "invalid_client") throw new Error("Client ID o Client Secret incorrectos. Copialos de nuevo desde developer.spotify.com");
    throw new Error(data.error_description || data.error || "Error " + resp.status);
  }
  if (!data.access_token) throw new Error("No se recibió token.");
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000, clientId };
  return data.access_token;
}

export async function GET(req) {
  let clientId = process.env.SPOTIFY_CLIENT_ID || "";
  let clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    clientId = req.nextUrl.searchParams.get("client_id") || "";
    clientSecret = req.nextUrl.searchParams.get("client_secret") || "";
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Faltan credenciales", setup: true }, { status: 400 });
  }

  const action = req.nextUrl.searchParams.get("action") || "search";
  const query = req.nextUrl.searchParams.get("q") || "";
  const id = req.nextUrl.searchParams.get("id") || "";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const headers = { "Authorization": "Bearer " + token };
    let apiUrl = "";

    if (action === "search") {
      if (!query) return NextResponse.json({ error: "Falta busqueda (q)" }, { status: 400 });
      const type = req.nextUrl.searchParams.get("type") || "album,artist";
      apiUrl = SPOTIFY_API_BASE + "/search?q=" + encodeURIComponent(query) + "&type=" + type + "&limit=" + limit + "&offset=" + offset;
    } else if (action === "album") {
      if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
      apiUrl = SPOTIFY_API_BASE + "/albums/" + id;
    } else if (action === "artist") {
      if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
      apiUrl = SPOTIFY_API_BASE + "/artists/" + id;
    } else if (action === "artist-albums") {
      if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
      apiUrl = SPOTIFY_API_BASE + "/artists/" + id + "/albums?limit=" + limit + "&offset=" + offset;
    } else if (action === "playlist") {
      if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
      apiUrl = SPOTIFY_API_BASE + "/playlists/" + id;
    } else if (action === "test") {
      // Use search to test credentials
      apiUrl = SPOTIFY_API_BASE + "/search?q=bad+bunny&type=album&limit=1";
    } else {
      return NextResponse.json({ error: "Accion no valida: " + action }, { status: 400 });
    }

    const resp = await fetch(apiUrl, { headers });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { return NextResponse.json({ error: "Spotify API error " + resp.status }, { status: resp.status }); }
    if (!resp.ok) {
      const msg = (data.error && data.error.message) || data.message || "Spotify error " + resp.status;
      return NextResponse.json({ error: msg }, { status: resp.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
