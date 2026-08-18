import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════
   /api/friends — amigos
   GET                → lista de amigos (con su perfil)
   GET ?buscar=texto  → busca usuarios por username
   POST {username}    → agrega un amigo por su @username
   DELETE {friend_id} → lo quita
   Requiere la tabla friendships (ver supabase-amigos.sql)
   ═══════════════════════════════════════════════════════ */

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

  const { data: rels, error } = await supabase
    .from("friendships")
    .select("id, friend_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    // La tabla no existe todavía: avisamos claro qué falta.
    return NextResponse.json({
      error: "Falta la tabla de amigos. Corré supabase-amigos.sql en Supabase → SQL Editor.",
      detalle: error.message,
    }, { status: 400 });
  }

  let amigos = [];
  if (rels && rels.length) {
    const ids = rels.map(r => r.friend_id);
    const { data: perfiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", ids);
    const porId = new Map((perfiles || []).map(p => [p.id, p]));
    amigos = rels.map(r => ({
      friendship_id: r.id,
      agregado: r.created_at,
      ...(porId.get(r.friend_id) || { id: r.friend_id, username: "?", display_name: "" }),
    }));
  }
  return NextResponse.json({ amigos });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { username } = await req.json();
  if (!username) return NextResponse.json({ error: "Falta username" }, { status: 400 });

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("username", username.trim().replace(/^@/, ""))
    .single();
  if (!perfil) return NextResponse.json({ error: "No existe ese usuario" }, { status: 404 });
  if (perfil.id === user.id) return NextResponse.json({ error: "Ese sos vos 😄" }, { status: 400 });

  const { error } = await supabase.from("friendships").insert({ user_id: user.id, friend_id: perfil.id });
  if (error) {
    if (String(error.message).includes("duplicate")) {
      return NextResponse.json({ error: "Ya es tu amigo" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, amigo: perfil });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { friend_id } = await req.json();
  if (!friend_id) return NextResponse.json({ error: "Falta friend_id" }, { status: 400 });

  const { error } = await supabase.from("friendships")
    .delete().eq("user_id", user.id).eq("friend_id", friend_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
