import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

/* /api/ajustes — tema, color y fuente sincronizados con tu cuenta.
   GET  → { ajustes: { tema, accent, fuente } }
   POST → guarda { tema, accent, fuente } en profiles.ajustes */

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { data } = await supabase.from("profiles").select("ajustes").eq("id", user.id).single();
  return NextResponse.json({ ajustes: data?.ajustes || {} });
}

export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ajustes = {};
  if (typeof body.tema === "string") ajustes.tema = body.tema.slice(0, 12);
  if (typeof body.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent)) ajustes.accent = body.accent;
  if (typeof body.fuente === "string") ajustes.fuente = body.fuente.slice(0, 12);

  const { error } = await supabase.from("profiles").update({ ajustes }).eq("id", user.id);
  if (error) {
    // Columna inexistente: falta correr supabase-social.sql
    return NextResponse.json({ error: "Corré supabase-social.sql en Supabase", detalle: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ajustes });
}
