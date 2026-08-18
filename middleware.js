import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function middleware(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured, just pass through
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    // Refresh session silently
    await supabase.auth.getUser();
  } catch {
    // If anything fails, just continue
  }

  return response;
}

export const config = {
  matcher: [
    /* Excluimos los API públicos (música, portadas, descargas): no usan
       sesión y el refresh de Supabase les sumaba cientos de ms A CADA
       request — con ~30 portadas por pantalla, el feed se arrastraba. */
    "/((?!_next/static|_next/image|favicon.ico|api/music|api/browse|api/proxy|api/download-mp3|api/download|api/mirror|api/spotify|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
