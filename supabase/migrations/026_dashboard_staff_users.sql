-- ====================================
-- DASHBOARD STAFF USERS & SESSIONS
-- ====================================
-- Supports username/password authentication for Announcement Studio
-- Supports role hierarchy: owner, super_admin, admin, moderator
-- Supports linking staff accounts to AniList/MAL/Simkl user IDs

CREATE TABLE IF NOT EXISTS dashboard_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'moderator',
    display_name VARCHAR(100),
    avatar_url TEXT,
    linked_client_type VARCHAR(20),  -- 'anilist', 'myanimelist', 'simkl'
    linked_user_id VARCHAR(100),     -- e.g. AniList ID '5724017'
    linked_username VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    
    CONSTRAINT valid_dashboard_role CHECK (role IN ('owner', 'super_admin', 'admin', 'moderator'))
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users(username);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users(role);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_linked ON dashboard_users(linked_client_type, linked_user_id);

-- Sessions table for persistent dashboard logins
CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token ON dashboard_sessions(token);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user_id ON dashboard_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at ON dashboard_sessions(expires_at);

-- Trigger for updated_at
CREATE TRIGGER update_dashboard_users_updated_at 
    BEFORE UPDATE ON dashboard_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
