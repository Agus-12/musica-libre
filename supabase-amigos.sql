-- ═══════════════════════════════════════════════════════
-- AURA — Amigos
-- Pegá esto en Supabase → SQL Editor → Run (una sola vez)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id),
  CHECK (user_id <> friend_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver mis amistades" ON public.friendships;
DROP POLICY IF EXISTS "Agregar amigos" ON public.friendships;
DROP POLICY IF EXISTS "Quitar amigos" ON public.friendships;

-- Ves las amistades donde participás (te agregaron o agregaste)
CREATE POLICY "Ver mis amistades" ON public.friendships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "Agregar amigos" ON public.friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Quitar amigos" ON public.friendships
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS friendships_user_idx ON public.friendships(user_id);
CREATE INDEX IF NOT EXISTS friendships_friend_idx ON public.friendships(friend_id);
