import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════
   /api/friends — amigos con SOLICITUDES
   GET                → { amigos, solicitudes (recibidas), enviadas }
   GET ?buscar=texto  → busca usuarios por username
   POST {username}    → manda SOLICITUD de amistad
   POST {aceptar}     → acepta una solicitud (id de friendship)
   POST {rechazar}    → rechaza una solicitud (la borra)
   DELETE {friend_id} → deshace la amistad
   Requiere friendships (supabase-social.sql); las solicitudes
   usan la columna status (supabase-social-2.sql). Si esa columna
   no existe todavía, cae al modo viejo (agregar directo).
   ═══════════════════════════════════════════════════════ */

async function perfilesDe(supabase, ids) {
  if (!ids.length) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", ids);
  return new Map((data || []).map(p => [p.id, p]));
}

export async function GET(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const buscar = req.nextUrl.searchParams.get("buscar");
  if (buscar) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .ilike("username", "%" + buscar.replace(/[%_]/g, "") + "%")
      .neq("id", user.id)
      .limit(8);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ usuarios: data || [] });
  }

  /* Amistades en los DOS sentidos (yo agregué / me agregaron) */
  let conStatus = true;
  let { data: rels, error } = await supabase
    .from("friendships")
    .select("id, user_id, friend_id, status, created_at")
    .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
    .order("created_at", { ascending: false });
  if (error && /status/i.test(error.message || "")) {
    /* Todavía no corrieron supabase-social-2.sql: modo viejo */
    conStatus = false;
    const res2 = await supabase
      .from("friendships")
      .select("id, user_id, friend_id, created_at")
      .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    rels = res2.data; error = res2.error;
  }
  if (error) {
    return NextResponse.json({
      error: "Falta la tabla de amigos. Corré supabase-social.sql en Supabase → SQL Editor.",
      detalle: error.message,
    }, { status: 400 });
  }

  const filas = rels || [];
  const otros = [...new Set(filas.map(r => (r.user_id === user.id ? r.friend_id : r.user_id)))];
  const porId = await perfilesDe(supabase, otros);
  const perfil = (id) => porId.get(id) || { id, username: "?", display_name: "" };

  const amigos = [], solicitudes = [], enviadas = [];
  const vistos = new Set();
  for (const r of filas) {
    const otroId = r.user_id === user.id ? r.friend_id : r.user_id;
    const estado = conStatus ? (r.status || "aceptada") : "aceptada";
    if (estado === "aceptada") {
      if (vistos.has(otroId)) continue;
      vistos.add(otroId);
      amigos.push({ friendship_id: r.id, agregado: r.created_at, ...perfil(otroId) });
    } else if (r.friend_id === user.id) {
      solicitudes.push({ friendship_id: r.id, ...perfil(r.user_id) });
    } else {
      enviadas.push({ friendship_id: r.id, ...perfil(r.friend_id) });
    }
  }
  return NextResponse.json({ amigos, solicitudes, enviadas, con_solicitudes: conStatus });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();

  /* ── Aceptar una solicitud: quedan amigos LOS DOS al instante ── */
  if (body.aceptar) {
    const { data, error } = await supabase
      .from("friendships")
      .update({ status: "aceptada" })
      .eq("id", body.aceptar)
      .eq("friend_id", user.id)
      .select("user_id")
      .single();
    if (error || !data) return NextResponse.json({ error: "No se pudo aceptar" }, { status: 400 });
    try {
      const { enviarPush } = await import("@/app/utils/push");
      const { data: yo } = await supabase.from("profiles").select("username, display_name").eq("id", user.id).single();
      await enviarPush([data.user_id], {
        titulo: "Solicitud aceptada",
        cuerpo: `@${yo?.username || "alguien"} aceptó tu solicitud. ¡Ya son amigos!`,
        url: "/profile",
      });
    } catch {}
    return NextResponse.json({ ok: true });
  }

  /* ── Rechazar una solicitud ── */
  if (body.rechazar) {
    await supabase.from("friendships").delete().eq("id", body.rechazar).eq("friend_id", user.id);
    return NextResponse.json({ ok: true });
  }

  /* ── Mandar solicitud por @username ── */
  const { username } = body;
  if (!username) return NextResponse.json({ error: "Falta username" }, { status: 400 });

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("username", username.trim().replace(/^@/, ""))
    .single();
  if (!perfil) return NextResponse.json({ error: "No existe ese usuario" }, { status: 404 });
  if (perfil.id === user.id) return NextResponse.json({ error: "Ese es tu propio usuario" }, { status: 400 });

  /* Si esa persona YA me había mandado solicitud, la aceptamos directo */
  const { data: inversa } = await supabase
    .from("friendships")
    .select("id, status")
    .eq("user_id", perfil.id)
    .eq("friend_id", user.id)
    .maybeSingle();
  if (inversa) {
    if (inversa.status && inversa.status !== "aceptada") {
      await supabase.from("friendships").update({ status: "aceptada" }).eq("id", inversa.id).eq("friend_id", user.id);
      return NextResponse.json({ ok: true, mensaje: "Esa persona ya te había mandado solicitud: ¡ya son amigos!" });
    }
    return NextResponse.json({ ok: true, mensaje: "Ya son amigos" });
  }

  /* Solicitud nueva (pendiente). Si la columna status no existe, cae
     al modo viejo: amistad directa. */
  let { error } = await supabase.from("friendships").insert({ user_id: user.id, friend_id: perfil.id, status: "pendiente" });
  let pendiente = true;
  if (error && /status/i.test(error.message || "")) {
    const r2 = await supabase.from("friendships").insert({ user_id: user.id, friend_id: perfil.id });
    error = r2.error; pendiente = false;
  }
  if (error) {
    if (String(error.message).includes("duplicate")) {
      return NextResponse.json({ error: "Ya le mandaste solicitud (o ya son amigos)" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const { enviarPush } = await import("@/app/utils/push");
    const { data: yo } = await supabase.from("profiles").select("username, display_name").eq("id", user.id).single();
    const quien = yo?.display_name || yo?.username || "Alguien";
    await enviarPush([perfil.id], {
      titulo: pendiente ? "Solicitud de amistad" : "Nuevo amigo",
      cuerpo: pendiente ? `${quien} (@${yo?.username || "?"}) quiere ser tu amigo. Entrá a Perfil para confirmar.` : `${quien} te agregó como amigo.`,
      url: "/profile",
    });
  } catch {}

  return NextResponse.json({ ok: true, pendiente, mensaje: pendiente ? "Solicitud enviada a @" + perfil.username : "Amigo agregado" });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { friend_id } = await req.json();
  if (!friend_id) return NextResponse.json({ error: "Falta friend_id" }, { status: 400 });

  /* La amistad puede existir en cualquiera de los dos sentidos */
  await supabase.from("friendships").delete().eq("user_id", user.id).eq("friend_id", friend_id);
  await supabase.from("friendships").delete().eq("user_id", friend_id).eq("friend_id", user.id);
  return NextResponse.json({ ok: true });
}
