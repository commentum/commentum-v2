-- Add actor_avatar column to notifications table
-- Stores the profile picture URL of whoever triggered the notification
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_avatar TEXT;
