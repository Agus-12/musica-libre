import { createClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";

// OAuth callback (Google login)
export async function GET(request) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL("/spotify", request.url));
}
