-- AURA Premium / Mercado Pago
-- Ejecutar una vez en Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.suscripciones (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  estado TEXT NOT NULL DEFAULT 'free' CHECK (estado IN ('free','pending','active','paused','cancelled','expired','rejected')),
  proveedor TEXT NOT NULL DEFAULT 'mercado_pago',
  mp_preapproval_id TEXT,
  mp_last_payment_id TEXT,
  mp_payer_email TEXT,
  vence_en TIMESTAMPTZ,
  acceso_libre BOOLEAN NOT NULL DEFAULT FALSE,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suscripciones_select_propias" ON public.suscripciones;
CREATE POLICY "suscripciones_select_propias" ON public.suscripciones FOR SELECT USING (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';

-- Tras crear tu cuenta, marca tu usuario como owner/acceso libre con:
-- UPDATE public.suscripciones SET acceso_libre = true, plan = 'premium', estado = 'active' WHERE user_id = 'TU_UUID';
