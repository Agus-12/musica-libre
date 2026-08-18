-- ═══════════════════════════════════════════════════════════════
-- AURA — Social (TODO EN UNO, se puede correr las veces que sea)
-- Supabase → SQL Editor → pegar → Run
-- Incluye: amigos + ajustes sincronizados + compartir canciones
-- ═══════════════════════════════════════════════════════════════

-- 1. Amigos (idéntico a supabase-amigos.sql; por si no se corrió)
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
CREATE POLICY "Ver mis amistades" ON public.friendships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "Agregar amigos" ON public.friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Quitar amigos" ON public.friendships
  FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS friendships_user_idx ON public.friendships(user_id);
CREATE INDEX IF NOT EXISTS friendships_friend_idx ON public.friendships(friend_id);

-- 2. Ajustes sincronizados (tema, color, fuente siguen tu cuenta)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ajustes JSONB DEFAULT '{}';

-- 3. Los amigos pueden VER tus favoritos (solo leer, nada más)
DROP POLICY IF EXISTS "Amigos ven favoritos" ON public.favorites;
CREATE POLICY "Amigos ven favoritos" ON public.favorites
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.user_id = auth.uid() AND f.friend_id = favorites.user_id
    )
  );

-- 4. Compartir canciones entre amigos (buzón)
CREATE TABLE IF NOT EXISTS public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  to_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  item JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ver mis shares" ON public.shares;
DROP POLICY IF EXISTS "Enviar a amigos" ON public.shares;
DROP POLICY IF EXISTS "Borrar mis shares" ON public.shares;
CREATE POLICY "Ver mis shares" ON public.shares
  FOR SELECT USING (auth.uid() = to_id OR auth.uid() = from_id);
-- Solo podés enviar a alguien que agregaste como amigo
CREATE POLICY "Enviar a amigos" ON public.shares
  FOR INSERT WITH CHECK (
    auth.uid() = from_id
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.user_id = auth.uid() AND f.friend_id = shares.to_id
    )
  );
CREATE POLICY "Borrar mis shares" ON public.shares
  FOR DELETE USING (auth.uid() = to_id OR auth.uid() = from_id);
CREATE INDEX IF NOT EXISTS shares_to_idx ON public.shares(to_id);
