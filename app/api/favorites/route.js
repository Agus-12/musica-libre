import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

// Favorites API
export async function GET(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type"); // album, artist, track, or null for all

  let query = supabase.from("favorites").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (type) query = query.eq("item_type", type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ favorites: data });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { item_type, item_id, name, artist, cover_url, source, extra_data } = body;

  if (!item_type || !item_id || !name) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await supabase.from("favorites").insert({
    user_id: user.id,
    item_type,
    item_id,
    name,
    artist: artist || "",
    cover_url: cover_url || "",
    source: source || "deezer",
    extra_data: extra_data || {},
  }).select().single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Ya está en favoritos" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ favorite: data });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { item_type, item_id } = await req.json();
  if (!item_type || !item_id) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  const { error } = await supabase.from("favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("item_type", item_type)
    .eq("item_id", item_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
