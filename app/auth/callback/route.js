import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Confirmación de email + OAuth (Google).
// Intercambia el código / token y manda a /auth/listo
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") || "signup";
  const errorParam = url.searchParams.get("error");

  let response = NextResponse.redirect(new URL("/auth/listo?ok=1", request.url));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL("/auth/listo?ok=0", request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.redirect(new URL("/auth/listo?ok=1", request.url));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  let ok = false;
  try {
    if (errorParam) {
      ok = false;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
    } else if (token_hash) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash });
      ok = !error;
    } else {
      // Puede venir el token en el hash (#access_token=). Eso lo lee /auth/listo.
      ok = true;
    }
  } catch {
    ok = false;
  }

  const dest = new URL(ok ? "/auth/listo?ok=1" : "/auth/listo?ok=0", request.url);
  const final = NextResponse.redirect(dest);
  response.cookies.getAll().forEach((c) => {
    final.cookies.set(c.name, c.value);
  });
  return final;
}
