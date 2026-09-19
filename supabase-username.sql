-- Unicidad real, sin distinguir mayúsculas/minúsculas.
-- Ejecutar una vez en Supabase SQL Editor.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique
ON public.profiles (LOWER(username));
NOTIFY pgrst, 'reload schema';
