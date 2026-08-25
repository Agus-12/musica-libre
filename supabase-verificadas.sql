-- Canciones verificadas: un usuario dice "sí, esta es"
-- y TODOS los demás dejan de recibir la pregunta.
-- Pegalo en Supabase → SQL Editor → Run.

CREATE TABLE IF NOT EXISTS public.canciones_verificadas (
  clave TEXT PRIMARY KEY,
  video_id TEXT,
  artist TEXT,
  title TEXT,
  query TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.canciones_verificadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verif_select" ON public.canciones_verificadas;
DROP POLICY IF EXISTS "verif_insert" ON public.canciones_verificadas;
DROP POLICY IF EXISTS "verif_update" ON public.canciones_verificadas;

CREATE POLICY "verif_select" ON public.canciones_verificadas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "verif_insert" ON public.canciones_verificadas
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "verif_update" ON public.canciones_verificadas
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
