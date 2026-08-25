import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* Devuelve los permisos efectivos del usuario autenticado.
   limite_offline = 0 significa ilimitado. */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data } = await supabase
    .from("suscripciones")
    .select("plan,estado,vence_en,acceso_libre,aura_libre,limite_offline")
    .eq("user_id", user.id)
    .maybeSingle();

  const hoy = new Date();
  const premiumActivo = Boolean(
    data?.plan === "premium" &&
    data?.estado === "active" &&
    (!data?.vence_en || new Date(data.vence_en) > hoy)
  );
  const auraLibre = Boolean(data?.acceso_libre || data?.aura_libre);
  const ilimitado = premiumActivo || auraLibre;
  const limite = ilimitado ? 0 : 50;

  return NextResponse.json({
    plan: premiumActivo ? "premium" : auraLibre ? "aura_libre" : "free",
    premium: premiumActivo,
    aura_libre: auraLibre,
    ilimitado,
    limite_offline: limite,
    vence_en: data?.vence_en || null,
  });
}
