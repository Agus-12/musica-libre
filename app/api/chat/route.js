import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════
   /api/chat — chat entre amigos
   GET            → { noLeidos: { from_id: cantidad } }
   GET ?con=ID    → { mensajes: [...] } (y los marca leídos)
   POST {to_id, texto} → manda un mensaje (+push al amigo)
   Requiere la tabla mensajes (supabase-social-2.sql).
   ═══════════════════════════════════════════════════════ */

export async function GET(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const con = req.nextUrl.searchParams.get("con");

  if (con) {
    const { data, error } = await supabase
      .from("mensajes")
      .select("id, from_id, to_id, texto, item, created_at, leido")
      .or(`and(from_id.eq.${user.id},to_id.eq.${con}),and(from_id.eq.${con},to_id.eq.${user.id})`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({
        error: "Falta la tabla de chat. Corré supabase-social-2.sql en Supabase → SQL Editor.",
        detalle: error.message,
      }, { status: 400 });
    }
    /* Lo que me mandó este amigo queda como leído */
    try {
      await supabase.from("mensajes").update({ leido: true })
        .eq("from_id", con).eq("to_id", user.id).eq("leido", false);
    } catch {}
    return NextResponse.json({ mensajes: (data || []).reverse() });
  }

  /* Sin ?con → conteo de no leídos por amigo (para los badges) */
  const { data, error } = await supabase
    .from("mensajes")
    .select("from_id")
    .eq("to_id", user.id)
    .eq("leido", false)
    .limit(500);
  if (error) return NextResponse.json({ noLeidos: {}, sin_tabla: true });
  const noLeidos = {};
  for (const m of data || []) noLeidos[m.from_id] = (noLeidos[m.from_id] || 0) + 1;
  return NextResponse.json({ noLeidos });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { to_id, texto, item } = await req.json();
  const esItem = item && typeof item === "object" && (item.name || item.title);
  const limpio = String(texto || "").trim().slice(0, 1000)
    || (esItem ? `${item.type === "playlist" ? "Playlist" : "Canción"}: ${item.name || item.title}${item.artist ? " — " + item.artist : ""}` : "");
  if (!to_id || !limpio) return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });

  const fila = { from_id: user.id, to_id, texto: limpio };
  if (esItem) fila.item = {
    type: item.type || "track",
    name: item.name || item.title || "",
    artist: item.artist || "",
    cover: item.cover || item.cover_url || "",
    album_id: item.album_id || "",
    playlist_id: item.playlist_id || "",
    source: item.source || "itunes",
  };

  let { data, error } = await supabase
    .from("mensajes")
    .insert(fila)
    .select()
    .single();
  /* Si la columna item no existe todavía (falta re-correr el SQL),
     mandamos el mensaje igual, solo como texto. */
  if (error && esItem && /item/i.test(error.message || "")) {
    const r2 = await supabase.from("mensajes").insert({ from_id: user.id, to_id, texto: limpio }).select().single();
    data = r2.data; error = r2.error;
  }
  if (error) {
    const msg = /policy|security/i.test(error.message || "")
      ? "Solo podés chatear con amigos confirmados"
      : /relation|exist/i.test(error.message || "")
        ? "Falta la tabla de chat. Corré supabase-social-2.sql en Supabase."
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  /* Push al amigo (si activó notificaciones) */
  try {
    const { enviarPush } = await import("@/app/utils/push");
    const { data: yo } = await supabase.from("profiles").select("username, display_name").eq("id", user.id).single();
    const quien = yo?.display_name || yo?.username || "Alguien";
    await enviarPush([to_id], {
      titulo: esItem
        ? `${quien} te mandó una ${fila.item?.type === "playlist" ? "playlist" : "canción"}`
        : `Mensaje de ${quien}`,
      cuerpo: esItem ? `${fila.item?.name || ""}${fila.item?.artist ? " — " + fila.item.artist : ""}` : limpio.slice(0, 90),
      url: "/profile",
    });
  } catch {}

  return NextResponse.json({ ok: true, mensaje: data });
}
