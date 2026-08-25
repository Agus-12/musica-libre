import { NextResponse } from "next/server";
import { createClient } from "@/app/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { baseMac } from "@/app/utils/servidorCasa";

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clavesDe({ artist, title, q }) {
  const out = new Set();
  const a = norm(artist);
  const t = norm(title);
  const query = norm(q);
  if (a || t) out.add(`${a}|${t}`);
  if (a && t) out.add(`${a} ${t}`);
  if (query) out.add(query);
  return [...out].filter(k => k && k !== "|").slice(0, 6);
}

function dbAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function leerNube(claves) {
  if (!claves.length) return null;
  const admin = dbAdmin();
  const supabase = admin || createClient();
  const { data, error } = await supabase
    .from("canciones_verificadas")
    .select("clave,video_id,artist,title")
    .in("clave", claves)
    .limit(1);
  if (error) return null;
  return data && data[0] ? data[0] : null;
}

async function guardarNube({ claves, videoId, artist, title, q }) {
  const admin = dbAdmin();
  const supabase = admin || createClient();
  let ok = false;
  for (const clave of claves) {
    const row = {
      clave,
      video_id: videoId || "",
      artist: artist || "",
      title: title || "",
      query: q || `${artist || ""} ${title || ""}`.trim(),
    };
    const { error } = await supabase.from("canciones_verificadas").upsert(row, { onConflict: "clave" });
    if (!error) ok = true;
  }
  return ok;
}

async function avisarMac({ q, videoId, ok }) {
  const base = await baseMac();
  if (!base) return null;
  const token = process.env.MUSICA_TOKEN || "";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (videoId) qs.set("v", videoId);
  if (ok) qs.set("ok", "1");
  if (token) qs.set("token", token);
  try {
    const resp = await fetch(`${base}/verificar?${qs}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    return await resp.json().catch(() => ({}));
  } catch {
    return null;
  }
}

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q") || "";
  const artist = p.get("artist") || "";
  const title = p.get("title") || "";
  const videoId = p.get("v") || p.get("video_id") || "";
  if (!query && !videoId && !artist && !title) {
    return NextResponse.json({ ok: false, error: "falta q" }, { status: 400 });
  }
  const q = query || `${artist} ${title}`.trim();
  const claves = clavesDe({ artist, title, q });

  if (p.get("ok") === "1") {
    const nube = await guardarNube({ claves, videoId, artist, title, q }).catch(() => false);
    const mac = await avisarMac({ q, videoId, ok: true });
    const ok = Boolean(nube || mac?.ok || mac?.verificada);
    return NextResponse.json({ ok, verificada: ok, videoId, nube: Boolean(nube), mac: Boolean(mac?.ok) });
  }

  const row = await leerNube(claves).catch(() => null);
  if (row) {
    return NextResponse.json({ ok: true, verificada: true, videoId: row.video_id || videoId || "", fuente: "nube" });
  }
  const mac = await avisarMac({ q, videoId, ok: false });
  if (mac && mac.verificada) {
    await guardarNube({ claves, videoId: mac.videoId || videoId, artist, title, q }).catch(() => {});
    return NextResponse.json({ ok: true, verificada: true, videoId: mac.videoId || videoId || "", fuente: "mac" });
  }
  return NextResponse.json({ ok: true, verificada: false, videoId: "" });
}
