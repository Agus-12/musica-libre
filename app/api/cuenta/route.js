import { createClient } from "@/app/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function DELETE() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const admin = adminDb();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  const uid = user.id;
  const tablas = [
    ["descargas_offline", "user_id"],
    ["suscripciones", "user_id"],
    ["push_subs", "user_id"],
    ["favorites", "user_id"],
    ["playlists", "user_id"],
    ["shares", "from_id"],
    ["shares", "to_id"],
    ["friendships", "user_id"],
    ["friendships", "friend_id"],
    ["mensajes", "from_id"],
    ["mensajes", "to_id"],
    ["chat", "from_id"],
    ["chat", "to_id"],
  ];
  for (const [tabla, col] of tablas) {
    try { await admin.from(tabla).delete().eq(col, uid); } catch {}
  }
  try { await admin.from("profiles").delete().eq("id", uid); } catch {}

  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try { await supabase.auth.signOut(); } catch {}
  return NextResponse.json({ ok: true });
}
