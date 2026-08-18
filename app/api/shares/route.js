import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* /api/shares — canciones compartidas entre amigos (buzón)
   GET            → lo que te mandaron (con el perfil del remitente)
   POST {to_id, item} → mandar una canción/álbum a un amigo
   DELETE {id}    → sacarlo del buzón */

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: recibidos, error } = await supabase
    .from("shares").select("id, from_id, item, created_at")
    .eq("to_id", user.id).order("created_at", { ascending: false }).limit(50);
  if (error) {
    return NextResponse.json({ error: "Corré supabase-social.sql en Supabase", detalle: error.message }, { status: 400 });
  }

  let resultado = [];
  if (recibidos && recibidos.length) {
    const ids = [...new Set(recibidos.map(r => r.from_id))];
    const { data: perfiles } = await supabase
      .from("profiles").select("id, username, display_name").in("id", ids);
    const porId = new Map((perfiles || []).map(p => [p.id, p]));
    resultado = recibidos.map(r => ({
      ...r,
      de: porId.get(r.from_id) || { username: "?" },
    }));
  }
  return NextResponse.json({ recibidos: resultado });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { to_id, item } = await req.json().catch(() => ({}));
  if (!to_id || !item || !item.name) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const limpio = {
    type: String(item.type || "track").slice(0, 10),
    name: String(item.name).slice(0, 200),
    artist: String(item.artist || "").slice(0, 200),
    cover: String(item.cover || "").slice(0, 500),
    album_id: String(item.album_id || "").slice(0, 40),
    playlist_id: String(item.playlist_id || "").slice(0, 40),
    source: String(item.source || "itunes").slice(0, 20),
  };
  const { error } = await supabase.from("shares").insert({ from_id: user.id, to_id, item: limpio });
  if (error) {
    const msg = String(error.message);
    if (msg.includes("policy")) return NextResponse.json({ error: "Solo podés enviar a tus amigos" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  /* Push al amigo, aunque tenga la app cerrada (si activó notificaciones) */
  try {
    const { enviarPush } = await import("@/app/utils/push");
    const { data: yo } = await supabase.from("profiles").select("username, display_name").eq("id", user.id).single();
    const quien = yo?.display_name || yo?.username || "Alguien";
    await enviarPush([to_id], {
      titulo: `${quien} te mandó una canción`,
      cuerpo: `${limpio.name}${limpio.artist ? " — " + limpio.artist : ""}`,
      url: "/profile",
    });
  } catch {}

  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  await supabase.from("shares").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
