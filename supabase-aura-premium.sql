-- AURA Premium / AURA Libre
-- Ejecutar después de supabase-pagos.sql en Supabase SQL Editor.
-- No contiene credenciales.

ALTER TABLE public.suscripciones
  ADD COLUMN IF NOT EXISTS limite_offline INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS aura_libre BOOLEAN NOT NULL DEFAULT FALSE;

-- Un usuario gratuito tiene 50 canciones offline; Premium y Aura Libre son ilimitados.
UPDATE public.suscripciones
SET limite_offline = CASE WHEN plan = 'premium' OR acceso_libre OR aura_libre THEN 0 ELSE 50 END;

-- Registro de canciones offline por cuenta. Una fila por canción única.
CREATE TABLE IF NOT EXISTS public.descargas_offline (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, track_key)
);
ALTER TABLE public.descargas_offline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offline_select_propias" ON public.descargas_offline;
DROP POLICY IF EXISTS "offline_insert_propias" ON public.descargas_offline;
DROP POLICY IF EXISTS "offline_delete_propias" ON public.descargas_offline;
CREATE POLICY "offline_select_propias" ON public.descargas_offline FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "offline_insert_propias" ON public.descargas_offline FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "offline_delete_propias" ON public.descargas_offline FOR DELETE USING (auth.uid() = user_id);

-- Solo el servidor con SUPABASE_SERVICE_ROLE_KEY podrá cambiar aura_libre.
-- El panel administrativo validará ADMIN_USER_ID antes de modificar esta columna.
NOTIFY pgrst, 'reload schema';
