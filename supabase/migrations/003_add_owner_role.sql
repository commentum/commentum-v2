-- Add owner role configuration
-- This adds a new role above super_admin that will be hidden in API responses

INSERT INTO config (key, value, description) VALUES 
('owner_users', '[]', 'JSON array of user IDs who have owner privileges (highest level, above super_admin)');

-- Owner role has the highest level of permissions and can:
-- - Manage all super_admin users
-- - Access all system configurations
-- - Perform any administrative action
-- - View and moderate all content
-- - Manage Discord integrations
-- - Access system logs and analytics

-- Note: Owner role will be displayed as 'super_admin' in API responses to hide its existence