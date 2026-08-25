import { createClient } from "@/app/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

async function owner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && process.env.ADMIN_USER_ID && user.id === process.env.ADMIN_USER_ID ? user : null;
}

export async function POST(req) {
  const admin = await owner();
  if (!admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id || "");
  const activo = Boolean(body.activo);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "user_id inválido" }, { status: 400 });

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await db.from("suscripciones").upsert({
    user_id: userId,
    aura_libre: activo,
    acceso_libre: activo,
    limite_offline: activo ? 0 : 50,
    ...(activo ? { plan: "free", estado: "free" } : {}),
    actualizado: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, aura_libre: activo });
}
