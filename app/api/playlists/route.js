import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

// Playlists API
export async function GET(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const playlistId = p.get("id");

  if (playlistId) {
    // Get single playlist with items
    const { data: playlist, error: plErr } = await supabase
      .from("playlists").select("*").eq("id", playlistId).single();
    if (plErr) return NextResponse.json({ error: plErr.message }, { status: 400 });

    const { data: items, error: itemsErr } = await supabase
      .from("playlist_items").select("*").eq("playlist_id", playlistId).order("added_at", { ascending: true });
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 400 });

    return NextResponse.json({ playlist, items: items || [] });
  }

  // Get all user playlists
  const { data, error } = await supabase
    .from("playlists").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ playlists: data });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  // Create playlist
  if (!action || action === "create") {
    const { name, description, is_public, cover_url } = body;
    if (!name) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

    const { data, error } = await supabase.from("playlists").insert({
      user_id: user.id,
      name,
      description: description || "",
      is_public: is_public !== false,
      /* Portada al crear (p. ej. la imagen ORIGINAL de una playlist
         importada). Si no viene, la primera canción se la presta. */
      cover_url: cover_url || null,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ playlist: data });
  }

  /* Agregar MUCHAS canciones de un jalón (guardar una playlist entera
     de Explorar). Antes se mandaba una por una y tardaba una eternidad. */
  if (action === "add-items") {
    const { playlist_id, items } = body;
    if (!playlist_id || !Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    }
    const filas = items.slice(0, 300).map(it => ({
      playlist_id,
      item_type: it.item_type || "track",
      item_id: String(it.item_id || ""),
      name: it.name || "",
      artist: it.artist || "",
      cover_url: it.cover_url || "",
      source: it.source || "deezer",
      extra_data: it.extra_data || {},
    })).filter(f => f.item_id && f.name);
    if (!filas.length) return NextResponse.json({ error: "Sin canciones válidas" }, { status: 400 });

    const { data, error } = await supabase.from("playlist_items").insert(filas).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabase.from("playlists").update({ updated_at: new Date().toISOString() }).eq("id", playlist_id);
    const cover = filas.find(f => f.cover_url)?.cover_url;
    if (cover) {
      const { data: pl } = await supabase.from("playlists").select("cover_url").eq("id", playlist_id).single();
      if (pl && !pl.cover_url) await supabase.from("playlists").update({ cover_url: cover }).eq("id", playlist_id);
    }
    return NextResponse.json({ agregados: (data || []).length });
  }

  // Add item to playlist
  if (action === "add-item") {
    const { playlist_id, item_type, item_id, name, artist, cover_url, source, extra_data } = body;
    if (!playlist_id || !item_type || !item_id || !name) {
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    }

    const { data, error } = await supabase.from("playlist_items").insert({
      playlist_id,
      item_type,
      item_id,
      name,
      artist: artist || "",
      cover_url: cover_url || "",
      source: source || "deezer",
      extra_data: extra_data || {},
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Update playlist timestamp
    await supabase.from("playlists").update({ updated_at: new Date().toISOString() }).eq("id", playlist_id);

    // Set playlist cover if it doesn't have one
    if (cover_url) {
      const { data: pl } = await supabase.from("playlists").select("cover_url").eq("id", playlist_id).single();
      if (pl && !pl.cover_url) {
        await supabase.from("playlists").update({ cover_url }).eq("id", playlist_id);
      }
    }

    return NextResponse.json({ item: data });
  }

  // Update playlist
  if (action === "update") {
    const { playlist_id, name, description, is_public, cover_url } = body;
    if (!playlist_id) return NextResponse.json({ error: "playlist_id requerido" }, { status: 400 });

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (is_public !== undefined) updates.is_public = is_public;
    if (cover_url !== undefined) updates.cover_url = cover_url;

    const { data, error } = await supabase.from("playlists").update(updates).eq("id", playlist_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ playlist: data });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}

export async function DELETE(req) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { action, playlist_id, item_id } = body;

  // Delete entire playlist
  if (!action || action === "delete-playlist") {
    if (!playlist_id) return NextResponse.json({ error: "playlist_id requerido" }, { status: 400 });
    const { error } = await supabase.from("playlists").delete().eq("id", playlist_id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Remove item from playlist
  if (action === "remove-item") {
    if (!item_id) return NextResponse.json({ error: "item_id requerido" }, { status: 400 });
    const { error } = await supabase.from("playlist_items").delete().eq("id", item_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}
