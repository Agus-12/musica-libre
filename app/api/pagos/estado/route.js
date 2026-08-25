import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  let { data } = await supabase.from("suscripciones").select("plan,estado,vence_en,acceso_libre,mp_preapproval_id").eq("user_id", user.id).maybeSingle();
  if (!data) data = { plan: "free", estado: "free", acceso_libre: false };
  const activo = Boolean(data.acceso_libre || (data.plan === "premium" && data.estado === "active" && (!data.vence_en || new Date(data.vence_en) > new Date())));
  return NextResponse.json({ ...data, activo });
}
