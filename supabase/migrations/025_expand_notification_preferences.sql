-- ============================================
-- Add announcement & recent comment preferences to notification_preferences
-- ============================================

ALTER TABLE notification_preferences 
ADD COLUMN IF NOT EXISTS notify_on_announcement BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS notify_on_recent_comment BOOLEAN DEFAULT TRUE;
