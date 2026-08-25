import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

const LIMITE = 50;

function limpiarKeys(lista) {
  const out = [];
  const visto = new Set();
  for (const raw of lista || []) {
    const k = String(raw || "").trim().slice(0, 300);
    if (!k || visto.has(k)) continue;
    visto.add(k);
    out.push(k);
  }
  return out;
}

async function planDe(supabase, userId) {
  const { data: sub } = await supabase
    .from("suscripciones")
    .select("plan,estado,vence_en,acceso_libre,aura_libre")
    .eq("user_id", userId)
    .maybeSingle();
  const premium = Boolean(
    sub?.plan === "premium" &&
    sub?.estado === "active" &&
    (!sub?.vence_en || new Date(sub.vence_en) > new Date())
  );
  return { ilimitado: premium || Boolean(sub?.acceso_libre || sub?.aura_libre) };
}

async function contar(supabase, userId) {
  const { count } = await supabase
    .from("descargas_offline")
    .select("track_key", { count: "exact", head: true })
    .eq("user_id", userId);
  return count || 0;
}

async function keysDe(supabase, userId) {
  const { data } = await supabase
    .from("descargas_offline")
    .select("track_key")
    .eq("user_id", userId);
  return (data || []).map(r => r.track_key);
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const keys = await keysDe(supabase, user.id);
  return NextResponse.json({ ok: true, count: keys.length, keys });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { ilimitado } = await planDe(supabase, user.id);

  if (body.action === "sync") {
    const grupos = Array.isArray(body.grupos) ? body.grupos : [];
    const purge = Boolean(body.purge);
    const actuales = await keysDe(supabase, user.id);
    const setActual = new Set(actuales);
    const keep = new Set();
    const aInsertar = [];
    const duplicados = [];

    for (const g of grupos) {
      const aliases = limpiarKeys(g);
      if (!aliases.length) continue;
      const matches = aliases.filter(a => setActual.has(a));
      if (matches.length) {
        keep.add(matches[0]);
        for (const extra of matches.slice(1)) duplicados.push(extra);
        continue;
      }
      aInsertar.push(aliases[0]);
    }

    const extras = purge
      ? actuales.filter(k => !keep.has(k))
      : duplicados;
    if (extras.length) {
      await supabase.from("descargas_offline").delete().eq("user_id", user.id).in("track_key", extras);
    }

    let insertadas = 0;
    for (const k of aInsertar) {
      if (!ilimitado) {
        const n = await contar(supabase, user.id);
        if (n >= LIMITE) break;
      }
      const { error } = await supabase.from("descargas_offline").insert({ user_id: user.id, track_key: k });
      if (!error) insertadas++;
    }

    const count = await contar(supabase, user.id);
    return NextResponse.json({ ok: true, count, borradas: extras.length, insertadas });
  }

  const aliases = limpiarKeys([
    body.track_key,
    ...(Array.isArray(body.aliases) ? body.aliases : []),
    ...(Array.isArray(body.track_keys) ? body.track_keys : []),
  ]);
  if (!aliases.length) return NextResponse.json({ error: "Falta track_key" }, { status: 400 });

  const { data: yaRows } = await supabase
    .from("descargas_offline")
    .select("track_key")
    .eq("user_id", user.id)
    .in("track_key", aliases)
    .limit(1);

  if (yaRows && yaRows.length) return NextResponse.json({ ok: true, ya: true, count: await contar(supabase, user.id) });

  if (!ilimitado) {
    const n = await contar(supabase, user.id);
    if (n >= LIMITE) {
      return NextResponse.json({ error: "Límite gratuito alcanzado", count: n, limite: LIMITE }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("descargas_offline")
    .insert({ user_id: user.id, track_key: aliases[0] });
  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      return NextResponse.json({ ok: true, ya: true, count: await contar(supabase, user.id) });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: await contar(supabase, user.id) });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.all) {
    const { error } = await supabase.from("descargas_offline").delete().eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: 0 });
  }

  const keys = limpiarKeys(
    Array.isArray(body.track_keys)
      ? body.track_keys
      : [body.track_key, ...(Array.isArray(body.aliases) ? body.aliases : [])]
  );
  if (!keys.length) return NextResponse.json({ error: "Falta track_key" }, { status: 400 });

  const { error } = await supabase
    .from("descargas_offline")
    .delete()
    .eq("user_id", user.id)
    .in("track_key", keys);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: await contar(supabase, user.id) });
}
