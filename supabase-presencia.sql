-- Presencia aproximada de usuarios para el panel de administración.
CREATE TABLE IF NOT EXISTS public.presencia_usuarios (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispositivo TEXT,
  ruta TEXT
);
ALTER TABLE public.presencia_usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presencia_propia_upsert" ON public.presencia_usuarios;
CREATE POLICY "presencia_propia_upsert" ON public.presencia_usuarios FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "presencia_propia_update" ON public.presencia_usuarios;
CREATE POLICY "presencia_propia_update" ON public.presencia_usuarios FOR UPDATE USING (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';
