import { NextResponse } from "next/server";
import { baseMac } from "@/app/utils/servidorCasa";

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const query = p.get("q") || "";
  const videoId = p.get("v") || p.get("video_id") || "";
  if (!query && !videoId) return NextResponse.json({ ok: false, error: "falta q" }, { status: 400 });
  const base = await baseMac();
  if (!base) return NextResponse.json({ ok: false, error: "MUSICA_SERVER vacia" });
  const token = process.env.MUSICA_TOKEN || "";
  const qs = new URLSearchParams();
  if (query) qs.set("q", query);
  if (videoId) qs.set("v", videoId);
  if (p.get("ok") === "1") qs.set("ok", "1");
  if (token) qs.set("token", token);
  try {
    const resp = await fetch(`${base}/verificar?${qs}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    return NextResponse.json({ ok: resp.ok, ...data }, { status: resp.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Mac no disponible", detalle: String(e.message || e).slice(0, 100) });
  }
}
