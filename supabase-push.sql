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
