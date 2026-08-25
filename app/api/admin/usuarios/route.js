import { createClient } from "@/app/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function isOwner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user && process.env.ADMIN_USER_ID && user.id === process.env.ADMIN_USER_ID);
}
export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) return NextResponse.json({ error: users.error.message }, { status: 500 });
  const { data: subs, error } = await db.from("suscripciones").select("user_id,plan,estado,vence_en,acceso_libre,aura_libre,limite_offline,actualizado");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byId = new Map((subs || []).map(s => [s.user_id, s]));
  const usuarios = (users.data?.users || []).map(u => ({ user_id: u.id, email: u.email || "", creado_en: u.created_at, ...(byId.get(u.id) || { plan: "free", estado: "free", vence_en: null, acceso_libre: false, aura_libre: false, limite_offline: 50, actualizado: null }) }));
  return NextResponse.json({ usuarios });
}
