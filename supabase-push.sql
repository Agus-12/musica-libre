-- ═══════════════════════════════════════════════════════
-- AURA — Notificaciones Push (Web Push real)
-- Supabase → SQL Editor → Run (una sola vez)
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.push_subs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  subscription JSONB NOT NULL,
  endpoint TEXT GENERATED ALWAYS AS (subscription->>'endpoint') STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
ALTER TABLE public.push_subs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Gestionar mis subs" ON public.push_subs;
CREATE POLICY "Gestionar mis subs" ON public.push_subs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subs(user_id);
NOTIFY pgrst, 'reload schema';

-- Estado interno: recordar qué versión ya se avisó (para que el push
-- de "hay versión nueva" salga UNA sola vez por deploy, automático)
CREATE TABLE IF NOT EXISTS public.app_config (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  actualizado TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- Nadie la toca desde el cliente; solo el servidor (service role)
NOTIFY pgrst, 'reload schema';
