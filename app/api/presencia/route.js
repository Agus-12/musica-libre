import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";
export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { error } = await supabase.from("presencia_usuarios").upsert({ user_id: user.id, ultima_actividad: new Date().toISOString(), dispositivo: String(body.dispositivo || "web").slice(0,40), ruta: String(body.ruta || "").slice(0,120) });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
