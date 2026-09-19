-- ============================================================================
-- Migration: Ensure gmail_accounts table, constraints, and indexes
-- Table for multi-user Gmail OAuth credential storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gmail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  google_account_id TEXT,
  email TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint ensuring one Gmail account record per (user_id, google_account_id)
-- Handles cases where google_account_id might be null by falling back to email
CREATE UNIQUE INDEX IF NOT EXISTS uq_gmail_accounts_user_google_account
ON public.gmail_accounts (user_id, COALESCE(google_account_id, email));

-- Secondary indexes for fast query lookups
CREATE INDEX IF NOT EXISTS idx_gmail_accounts_user_id
ON public.gmail_accounts (user_id);

CREATE INDEX IF NOT EXISTS idx_gmail_accounts_email
ON public.gmail_accounts (email);

-- Trigger function to automatically update updated_at timestamp on record updates
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gmail_accounts_updated_at ON public.gmail_accounts;

CREATE TRIGGER trg_gmail_accounts_updated_at
BEFORE UPDATE ON public.gmail_accounts
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security (RLS) defensively to block any public/anon client access
ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;
