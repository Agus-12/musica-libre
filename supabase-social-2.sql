-- ═══════════════════════════════════════════════════════════════
-- AURA — Social 2: SOLICITUDES DE AMISTAD + CHAT ENTRE AMIGOS
-- Supabase → SQL Editor → pegar → Run (se puede correr varias veces)
-- ═══════════════════════════════════════════════════════════════

-- 1. Solicitudes de amistad
--    Las amistades que ya existían quedan como 'aceptada' (el DEFAULT
--    aplica a las filas viejas). Las nuevas se crean como 'pendiente'
--    desde la app y el otro tiene que confirmar.
ALTER TABLE public.friendships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aceptada';

-- El que RECIBE la solicitud puede aceptarla (actualizar el status)
DROP POLICY IF EXISTS "Aceptar solicitudes" ON public.friendships;
CREATE POLICY "Aceptar solicitudes" ON public.friendships
  FOR UPDATE USING (auth.uid() = friend_id) WITH CHECK (auth.uid() = friend_id);

-- Cualquiera de los dos puede deshacer la amistad (o rechazar la solicitud)
DROP POLICY IF EXISTS "Quitar amigos" ON public.friendships;
CREATE POLICY "Quitar amigos" ON public.friendships
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- 2. Amistad ACEPTADA vale en los DOS sentidos:
--    los favoritos se ven entre ambos, y ambos pueden compartir.
DROP POLICY IF EXISTS "Amigos ven favoritos" ON public.favorites;
CREATE POLICY "Amigos ven favoritos" ON public.favorites
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'aceptada' AND (
        (f.user_id = auth.uid() AND f.friend_id = favorites.user_id) OR
        (f.friend_id = auth.uid() AND f.user_id = favorites.user_id)
      )
    )
  );

DROP POLICY IF EXISTS "Enviar a amigos" ON public.shares;
CREATE POLICY "Enviar a amigos" ON public.shares
  FOR INSERT WITH CHECK (
    auth.uid() = from_id
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'aceptada' AND (
        (f.user_id = auth.uid() AND f.friend_id = shares.to_id) OR
        (f.friend_id = auth.uid() AND f.user_id = shares.to_id)
      )
    )
  );

-- 3. CHAT entre amigos
CREATE TABLE IF NOT EXISTS public.mensajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  to_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  texto TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
  leido BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_id <> to_id)
);
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver mis mensajes" ON public.mensajes;
CREATE POLICY "Ver mis mensajes" ON public.mensajes
  FOR SELECT USING (auth.uid() = from_id OR auth.uid() = to_id);

-- Solo se puede escribir a un amigo ACEPTADO
DROP POLICY IF EXISTS "Escribir a amigos" ON public.mensajes;
CREATE POLICY "Escribir a amigos" ON public.mensajes
  FOR INSERT WITH CHECK (
    auth.uid() = from_id
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'aceptada' AND (
        (f.user_id = auth.uid() AND f.friend_id = mensajes.to_id) OR
        (f.friend_id = auth.uid() AND f.user_id = mensajes.to_id)
      )
    )
  );

-- El que recibe puede marcar como leído
DROP POLICY IF EXISTS "Marcar leido" ON public.mensajes;
CREATE POLICY "Marcar leido" ON public.mensajes
  FOR UPDATE USING (auth.uid() = to_id) WITH CHECK (auth.uid() = to_id);

CREATE INDEX IF NOT EXISTS mensajes_conv_idx ON public.mensajes(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS mensajes_noleidos_idx ON public.mensajes(to_id, leido);
