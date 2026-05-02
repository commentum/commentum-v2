-- ============================================
-- Notification History Table
-- Stores all push notifications so users can view them in-app
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    client_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,  -- FcmNotificationType
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    
    -- Comment info (nullable, depends on type)
    comment_id TEXT,
    media_id TEXT,
    media_type TEXT,
    media_title TEXT,
    
    -- Actor info (who triggered the notification)
    actor_id TEXT,
    actor_username TEXT,
    
    -- Moderator info (for mod actions)
    moderator_id TEXT,
    moderator_username TEXT,
    
    -- Extra context
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Deep link for navigation
    click_action TEXT,
    
    -- Read status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- FCM delivery status
    fcm_sent BOOLEAN DEFAULT FALSE,
    fcm_delivered BOOLEAN DEFAULT FALSE,
    fcm_error TEXT
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(client_type, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(client_type, user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(client_type, user_id, type);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS: Service role has full access
CREATE POLICY "Service role full access on notifications"
    ON notifications FOR ALL
    USING (auth.role() = 'service_role');
