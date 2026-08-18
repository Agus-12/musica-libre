import webpush from "web-push";
import { createClient as createAdmin } from "@supabase/supabase-js";

/* Utilidades de Web Push (lado servidor).
   Requiere en Vercel:
   - VAPID_PRIVATE_KEY            (la clave privada del par VAPID)
   - SUPABASE_SERVICE_ROLE_KEY    (para leer las suscripciones de otros
                                   usuarios al enviarles un push)        */

export const VAPID_PUBLIC_KEY = "BGtFZHPcbMcTfR4lyetmKGuQQvHfdRpc5df4ZDLn0FpDFoxfeDQWRvZVW4uEx8VS_bIwz8xtutlDXoKseeOOBAs";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdmin(url, key, { auth: { persistSession: false } });
}

/* Envía un push a los dispositivos de esos usuarios.
   userIds = null → a TODOS los suscritos (para avisos de versión). */
export async function enviarPush(userIds, payload) {
  const priv = process.env.VAPID_PRIVATE_KEY;
  const db = admin();
  if (!priv) return { enviados: 0, motivo: "Falta VAPID_PRIVATE_KEY en Vercel" };
  if (!db) return { enviados: 0, motivo: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" };

  webpush.setVapidDetails("mailto:aura@musica-libre.app", VAPID_PUBLIC_KEY, priv);

  let q = db.from("push_subs").select("id, subscription");
  if (Array.isArray(userIds)) q = q.in("user_id", userIds);
  const { data: subs, error } = await q;
  if (error) return { enviados: 0, motivo: error.message };

  let enviados = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 86400 });
      enviados++;
    } catch (e) {
      // Suscripción muerta (usuario borró la app, etc.): la limpiamos
      if (e.statusCode === 404 || e.statusCode === 410) {
        try { await db.from("push_subs").delete().eq("id", s.id); } catch {}
      }
    }
  }));
  return { enviados, total: (subs || []).length };
}
