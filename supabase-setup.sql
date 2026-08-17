-- ═══════════════════════════════════════════════════════
-- Música Libre - Base de datos Supabase (v2 - idempotente)
-- Podés ejecutarlo cuantas veces quieras sin errores
-- ═══════════════════════════════════════════════════════

-- 1. Borrar todo existente (en orden correcto por dependencias)
DROP POLICY IF EXISTS "Perfiles visibles para todos" ON public.profiles;
DROP POLICY IF EXISTS "Editar propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Insertar propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Ver propios favoritos" ON public.favorites;
DROP POLICY IF EXISTS "Insertar propios favoritos" ON public.favorites;
DROP POLICY IF EXISTS "Borrar propios favoritos" ON public.favorites;
DROP POLICY IF EXISTS "Ver playlists publicas" ON public.playlists;
DROP POLICY IF EXISTS "Insertar propias playlists" ON public.playlists;
DROP POLICY IF EXISTS "Editar propias playlists" ON public.playlists;
DROP POLICY IF EXISTS "Borrar propias playlists" ON public.playlists;
DROP POLICY IF EXISTS "Ver items de playlists visibles" ON public.playlist_items;
DROP POLICY IF EXISTS "Insertar items en propias playlists" ON public.playlist_items;
DROP POLICY IF EXISTS "Borrar items de propias playlists" ON public.playlist_items;

DROP TABLE IF EXISTS public.playlist_items;
DROP TABLE IF EXISTS public.favorites;
DROP TABLE IF EXISTS public.playlists;
DROP TABLE IF EXISTS public.profiles;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Tabla de perfiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de favoritos
CREATE TABLE public.favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('album', 'artist', 'track')),
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  source TEXT DEFAULT 'deezer',
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, item_type, item_id)
);

-- 4. Tabla de playlists
CREATE TABLE public.playlists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabla de items dentro de playlists
CREATE TABLE public.playlist_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('album', 'track')),
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  artist TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  source TEXT DEFAULT 'deezer',
  extra_data JSONB DEFAULT '{}',
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Índices
CREATE INDEX idx_favorites_user ON public.favorites(user_id);
CREATE INDEX idx_favorites_type ON public.favorites(user_id, item_type);
CREATE INDEX idx_playlists_user ON public.playlists(user_id);
CREATE INDEX idx_playlist_items_playlist ON public.playlist_items(playlist_id);

-- 7. RLS (seguridad)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Perfiles visibles para todos" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Editar propio perfil" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Insertar propio perfil" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Ver propios favoritos" ON public.favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insertar propios favoritos" ON public.favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Borrar propios favoritos" ON public.favorites FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Ver playlists publicas" ON public.playlists FOR SELECT USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "Insertar propias playlists" ON public.playlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Editar propias playlists" ON public.playlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Borrar propias playlists" ON public.playlists FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Ver items de playlists visibles" ON public.playlist_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.playlists WHERE playlists.id = playlist_items.playlist_id AND (playlists.is_public = true OR playlists.user_id = auth.uid()))
);
CREATE POLICY "Insertar items en propias playlists" ON public.playlist_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.playlists WHERE playlists.id = playlist_items.playlist_id AND playlists.user_id = auth.uid())
);
CREATE POLICY "Borrar items de propias playlists" ON public.playlist_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.playlists WHERE playlists.id = playlist_items.playlist_id AND playlists.user_id = auth.uid())
);

-- 8. Trigger: crear perfil al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
