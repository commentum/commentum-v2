-- ====================================
-- UPDATE SERVER CONFIGURATIONS TO SINGLE ROLE
-- ====================================

-- Drop existing table if it exists and recreate with single role
DROP TABLE IF EXISTS server_configs;

-- Create separate sequence for server configurations
CREATE SEQUENCE IF NOT EXISTS server_configs_seq START 1;

-- Create server configurations table with role_id as direct field
CREATE TABLE server_configs (
    id INTEGER PRIMARY KEY DEFAULT nextval('server_configs_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Server identification
    server_name TEXT UNIQUE NOT NULL,
    guild_id TEXT UNIQUE NOT NULL,
    webhook_url TEXT,
    role_id TEXT,
    
    -- Server status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Additional settings
    settings TEXT, -- JSON for additional server-specific settings
    
    -- Check constraints
    CONSTRAINT server_name_length CHECK (length(server_name) >= 2 AND length(server_name) <= 50),
    CONSTRAINT guild_id_length CHECK (length(guild_id) >= 15 AND length(guild_id) <= 25)
);

-- Indexes for server configurations
CREATE INDEX idx_server_configs_name ON server_configs(server_name);
CREATE INDEX idx_server_configs_guild ON server_configs(guild_id);
CREATE INDEX idx_server_configs_active ON server_configs(is_active);

-- Trigger for updated_at
CREATE TRIGGER update_server_configs_updated_at 
    BEFORE UPDATE ON server_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security for server configurations
ALTER TABLE server_configs ENABLE ROW LEVEL SECURITY;

-- Server configs RLS policies
-- Anyone can read active server configs (for bot operations)
CREATE POLICY "Anyone can read active server configs" ON server_configs
    FOR SELECT USING (is_active = true);

-- Only super admins can manage server configurations
CREATE POLICY "Super admins can manage server configs" ON server_configs
    FOR ALL USING (
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    ) WITH CHECK (
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Insert default server configurations with your format
INSERT INTO server_configs (server_name, guild_id, webhook_url, role_id) VALUES 
    ('AnymeX', 'YOUR_ANYMEX_GUILD_ID', 'YOUR_ANYMEX_WEBHOOK_URL', 'YOUR_ANYMEX_ROLE_ID'),
    ('ShonenX', 'YOUR_SHONENX_GUILD_ID', 'YOUR_SHONENX_WEBHOOK_URL', 'YOUR_SHONENX_ROLE_ID'),
    ('animestream', 'YOUR_ANIMESTREAM_GUILD_ID', 'YOUR_ANIMESTREAM_WEBHOOK_URL', 'YOUR_ANIMESTREAM_ROLE_ID');