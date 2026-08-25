import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

// Auth API — login, register, logout, session
export async function POST(req) {
  const supabase = createClient();
  const body = await req.json();
  const { action } = body;

  try {
    if (action === "register") {
      const { email, password, username } = body;
      if (!email || !password || !username) {
        return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
      }
      const origin = req.headers.get("origin") || new URL(req.url).origin;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username, full_name: username },
          emailRedirectTo: `${origin}/auth/callback`,
        },
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ user: data.user, session: data.session });
    }

    if (action === "login") {
      const { email, password } = body;
      if (!email || !password) {
        return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ user: data.user, session: data.session });
    }

    if (action === "logout") {
      const { error } = await supabase.auth.signOut();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req) {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ user: null });
  
  // Get profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return NextResponse.json({ user, profile });
}
