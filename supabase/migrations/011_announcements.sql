-- ====================================
-- ANNOUNCEMENTS SYSTEM
-- ====================================
-- Multi-app announcement system for AnymeX, ShonenX, and Animestream
-- Supports developer announcements with full CRUD and read tracking

-- ====================================
-- ANNOUNCEMENTS TABLE
-- ====================================

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  
  -- App identification (for multi-app support)
  app_id VARCHAR(50) NOT NULL,  -- 'anymex', 'shonenx', 'animestream'
  
  -- Content
  title VARCHAR(200) NOT NULL,
  short_description VARCHAR(500) NOT NULL,  -- Preview text
  full_content TEXT NOT NULL,  -- Markdown supported
  
  -- Metadata
  author_id VARCHAR(100),  -- Developer ID (from config or discord_users)
  author_name VARCHAR(100),  -- Display name
  
  -- Categorization (custom categories by devs)
  category VARCHAR(50) DEFAULT 'general',  -- 'general', 'update', 'bugfix', 'feature', 'maintenance', 'warning', or custom
  priority INTEGER DEFAULT 0,  -- Higher = more important (pinned)
  
  -- Targeting (optional)
  target_roles TEXT[],  -- NULL = all users, or ['moderator', 'admin'] for restricted
  target_platforms TEXT[],  -- NULL = all platforms, or ['anilist', 'mal']
  
  -- Status
  status VARCHAR(20) DEFAULT 'draft',  -- 'draft', 'published', 'archived'
  pinned BOOLEAN DEFAULT FALSE,  -- Pin to top
  featured BOOLEAN DEFAULT FALSE,  -- Featured announcement
  
  -- Timestamps
  published_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,  -- Optional expiration
  
  -- Tracking
  view_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT valid_app_id CHECK (app_id IN ('anymex', 'shonenx', 'animestream'))
);

-- Indexes for performance
CREATE INDEX idx_announcements_app_id ON announcements(app_id);
CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_published_at ON announcements(published_at DESC);
CREATE INDEX idx_announcements_app_status ON announcements(app_id, status);
CREATE INDEX idx_announcements_pinned ON announcements(pinned DESC, priority DESC, published_at DESC);
CREATE INDEX idx_announcements_category ON announcements(app_id, category);

-- ====================================
-- ANNOUNCEMENT READ STATUS (Per User)
-- ====================================

CREATE TABLE announcement_reads (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  app_id VARCHAR(50) NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(announcement_id, user_id, app_id)
);

CREATE INDEX idx_announcement_reads_user ON announcement_reads(user_id, app_id);
CREATE INDEX idx_announcement_reads_announcement ON announcement_reads(announcement_id);

-- ====================================
-- ANNOUNCEMENT VIEWS TRACKING
-- ====================================

CREATE TABLE announcement_views (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,
  user_id VARCHAR(100),  -- Can be anonymous
  app_id VARCHAR(50) NOT NULL,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_announcement_views_announcement ON announcement_views(announcement_id);

-- ====================================
-- CONFIG ENTRIES FOR ANNOUNCEMENTS
-- ====================================

INSERT INTO config (key, value) VALUES 
  ('announcements_enabled', 'true'),
  ('announcements_per_page', '20')
ON CONFLICT (key) DO NOTHING;

-- Add 'announcement_published' to discord_notification_types if not already present
-- This ensures Discord notifications are sent when announcements are published
UPDATE config 
SET value = (
  SELECT jsonb_set(
    value::jsonb,
    '$',
    (value::jsonb || '["announcement_published"]')
  )::text
  FROM config 
  WHERE key = 'discord_notification_types'
)
WHERE key = 'discord_notification_types'
AND NOT (value::jsonb ? 'announcement_published');

-- ====================================
-- GRANT PERMISSIONS
-- ====================================

GRANT SELECT ON announcements TO anon, authenticated;
GRANT SELECT ON announcement_reads TO anon, authenticated;
GRANT INSERT ON announcement_reads TO anon, authenticated;
GRANT INSERT ON announcement_views TO anon, authenticated;
