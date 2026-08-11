-- Supabase migration: call lifecycle logging
-- Created: 2026-08-11

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS ended_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_calls_ended_by ON public.calls (ended_by);

CREATE OR REPLACE FUNCTION public.set_call_duration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.started_at IS NOT NULL AND NEW.ended_at IS NOT NULL THEN
    NEW.duration_seconds := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)))::integer);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_call_duration ON public.calls;
CREATE TRIGGER trigger_set_call_duration
BEFORE INSERT OR UPDATE OF started_at, ended_at ON public.calls
FOR EACH ROW EXECUTE FUNCTION public.set_call_duration();
