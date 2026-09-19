import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

const RE = /^[a-z0-9_]{3,24}$/;
export async function POST(req) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim().replace(/^@/, "").toLowerCase();
  if (!RE.test(username)) return NextResponse.json({ error: "Usa 3–24 caracteres: letras, números o guion bajo." }, { status: 400 });
  const { data: existente, error: checkError } = await supabase.from("profiles").select("id").ilike("username", username).neq("id", user.id).maybeSingle();
  if (checkError) return NextResponse.json({ error: "No se pudo comprobar el nombre", detalle: checkError.message }, { status: 500 });
  if (existente) return NextResponse.json({ error: "Ese nombre de usuario ya está ocupado." }, { status: 409 });
  const { data, error } = await supabase.from("profiles").update({ username }).eq("id", user.id).select("id,username,display_name,avatar_url,bio").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Ese nombre de usuario ya está ocupado." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, profile: data });
}
