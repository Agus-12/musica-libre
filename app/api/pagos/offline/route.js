import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const trackKey = String(body.track_key || "").slice(0, 300);
  if (!trackKey) return NextResponse.json({ error: "Falta track_key" }, { status: 400 });
  const { data: sub } = await supabase.from("suscripciones").select("plan,estado,vence_en,acceso_libre,aura_libre").eq("user_id", user.id).maybeSingle();
  const premium = Boolean(sub?.plan === "premium" && sub?.estado === "active" && (!sub?.vence_en || new Date(sub.vence_en) > new Date()));
  const ilimitado = premium || Boolean(sub?.acceso_libre || sub?.aura_libre);
  const { data: ya } = await supabase.from("descargas_offline").select("track_key").eq("user_id", user.id).eq("track_key", trackKey).maybeSingle();
  if (!ya && !ilimitado) {
    const { count } = await supabase.from("descargas_offline").select("track_key", { count: "exact", head: true }).eq("user_id", user.id);
    if ((count || 0) >= 50) return NextResponse.json({ error: "Límite gratuito alcanzado" }, { status: 403 });
  }
  const { error } = await supabase.from("descargas_offline").upsert({ user_id: user.id, track_key: trackKey }, { onConflict: "user_id,track_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}


export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const keys = Array.isArray(body.track_keys)
    ? body.track_keys.map(k => String(k).slice(0, 300)).filter(Boolean)
    : [String(body.track_key || "").slice(0, 300)].filter(Boolean);

  if (!keys.length) {
    return NextResponse.json({ error: "Falta track_key" }, { status: 400 });
  }

  const { error } = await supabase
    .from("descargas_offline")
    .delete()
    .eq("user_id", user.id)
    .in("track_key", keys);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
