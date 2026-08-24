import { createClient as createAdmin } from "@supabase/supabase-js";

/* ═══════════════════════════════════════════════════════════════
   ¿Dónde está la Mac de casa AHORITA?
   El túnel de trycloudflare cambia de URL cada vez que se reinicia.
   El guardián de la Mac (tunel.js) publica la URL nueva en
   app_config (clave "musica_server") vía /api/tunel, y AQUÍ todos
   los endpoints la leen. Si no hay nada publicado, se usa la
   variable MUSICA_SERVER de Vercel como respaldo.
   Con caché de 60s para no pegarle a Supabase en cada descarga.
   ═══════════════════════════════════════════════════════════════ */

let cacheBase = { url: "", ts: 0 };

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdmin(url, key, { auth: { persistSession: false } });
}

export async function baseMac() {
  if (cacheBase.url && Date.now() - cacheBase.ts < 60 * 1000) return cacheBase.url;
  let url = "";
  try {
    const db = admin();
    if (db) {
      const { data } = await db.from("app_config").select("valor").eq("clave", "musica_server").maybeSingle();
      if (data?.valor && /^https:\/\//.test(data.valor)) url = data.valor;
    }
  } catch {}
  if (!url) url = process.env.MUSICA_SERVER || "";
  url = url.replace(/\/+$/, "");
  cacheBase = { url, ts: Date.now() };
  return url;
}

/* Guardar la URL nueva (la llama /api/tunel) */
export async function guardarBaseMac(url) {
  const db = admin();
  if (!db) return { error: "Falta SUPABASE_SERVICE_ROLE_KEY" };
  const { error } = await db.from("app_config").upsert({ clave: "musica_server", valor: url, actualizado: new Date().toISOString() });
  if (error) return { error: error.message };
  cacheBase = { url: url.replace(/\/+$/, ""), ts: Date.now() };
  return { ok: true };
}
