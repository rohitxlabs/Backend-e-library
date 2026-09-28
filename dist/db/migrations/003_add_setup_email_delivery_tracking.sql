-- Bookkeeping for the background email worker.
--
-- setup_email_claim_id / setup_email_claimed_at: a short lease. A worker claims a batch of rows
--   (UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)), sends the emails outside any
--   transaction, then clears the claim. Other workers skip claimed rows; if a worker crashes,
--   the lease expires and the rows become eligible again.
-- setup_email_attempts / setup_email_next_attempt_at: failed sends are retried with backoff
--   instead of every minute forever; after EMAIL_MAX_ATTEMPTS an admin must resend manually.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS setup_email_claim_id UUID,
    ADD COLUMN IF NOT EXISTS setup_email_claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS setup_email_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS setup_email_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS setup_email_last_error TEXT;
