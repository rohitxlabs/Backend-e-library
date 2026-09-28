-- Only SHA-256(raw token) is stored. The raw token exists solely inside the email that was sent.

CREATE TABLE IF NOT EXISTS password_setup_tokens (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FK lookups / ON DELETE CASCADE.
CREATE INDEX IF NOT EXISTS password_setup_tokens_user_id_idx
    ON password_setup_tokens (user_id);

-- Invalidating a user's outstanding tokens only touches unused rows.
CREATE INDEX IF NOT EXISTS password_setup_tokens_unused_user_idx
    ON password_setup_tokens (user_id)
    WHERE used_at IS NULL;

-- Periodic cleanup of old tokens.
CREATE INDEX IF NOT EXISTS password_setup_tokens_expires_at_idx
    ON password_setup_tokens (expires_at);
