import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* /api/friends/perfil?id=<uuid> — el perfil público de un amigo:
   sus datos, sus favoritos (la RLS solo lo permite si son amigos)
   y sus playlists públicas. */

export async function GET(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  // ¿Es tu amigo?
  const { data: rel } = await supabase
    .from("friendships").select("id")
    .eq("user_id", user.id).eq("friend_id", id).maybeSingle();
  if (!rel) return NextResponse.json({ error: "Solo podés ver perfiles de tus amigos" }, { status: 403 });

  const [{ data: perfil }, { data: favoritos }, { data: playlists }] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, avatar_url, bio").eq("id", id).single(),
    supabase.from("favorites").select("item_type, item_id, name, artist, cover_url, source, extra_data")
      .eq("user_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("playlists").select("id, name, description, cover_url")
      .eq("user_id", id).eq("is_public", true).limit(20),
  ]);

  return NextResponse.json({
    perfil: perfil || null,
    favoritos: favoritos || [],
    playlists: playlists || [],
  });
}
