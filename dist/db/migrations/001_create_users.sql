-- Users are inserted manually (e.g. INSERT INTO users (email) VALUES (...)).
-- The background worker picks up every row that has no password and no setup email yet.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    is_password_set BOOLEAN NOT NULL DEFAULT FALSE,
    setup_email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_format_chk CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_password_state_chk CHECK (is_password_set = (password_hash IS NOT NULL))
);

-- Normalize email on every insert/update, including rows added by hand in the Neon SQL editor,
-- so "  John@Example.COM " and "john@example.com" collide on the UNIQUE constraint.
CREATE OR REPLACE FUNCTION users_normalize_email() RETURNS trigger AS $$
BEGIN
    NEW.email := lower(regexp_replace(NEW.email, '^\s+|\s+$', '', 'g'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_normalize_email_trg ON users;
CREATE TRIGGER users_normalize_email_trg
    BEFORE INSERT OR UPDATE OF email ON users
    FOR EACH ROW EXECUTE FUNCTION users_normalize_email();

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at_trg ON users;
CREATE TRIGGER users_set_updated_at_trg
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Partial index: only rows still waiting for a setup email are indexed, so the worker's lookup
-- stays fast no matter how many users have already completed setup.
CREATE INDEX IF NOT EXISTS users_pending_setup_email_idx
    ON users (id)
    WHERE is_password_set = FALSE AND setup_email_sent_at IS NULL;
