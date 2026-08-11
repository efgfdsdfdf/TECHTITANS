-- Supabase migration: admin-safe profile management
-- Created: 2026-08-11

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

-- These policies support projects where profiles RLS is already enabled.
-- Do not force-enable RLS here; existing chat/member-list screens may rely on
-- the project's current profile visibility model.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_authenticated'
  ) THEN
    CREATE POLICY profiles_select_authenticated
    ON public.profiles
    FOR SELECT
    USING (
      auth.uid() IS NOT NULL
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_admin'
  ) THEN
    CREATE POLICY profiles_update_admin
    ON public.profiles
    FOR UPDATE
    USING (
      public.is_admin_user()
    )
    WITH CHECK (
      public.is_admin_user()
    );
  END IF;
END $$;
