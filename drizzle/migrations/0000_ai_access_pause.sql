CREATE TABLE public.ai_access_pause (id boolean PRIMARY KEY DEFAULT true CHECK (id), message text NOT NULL, paused_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.ai_access_pause TO service_role;
REVOKE ALL ON public.ai_access_pause FROM anon, authenticated;
ALTER TABLE public.ai_access_pause ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ai_access_pause IS 'Server-only durable AI access pause. No SQL, prompts, or user data. Owner removes the pause after restoring provider access.';