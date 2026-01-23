-- ====================================
-- DISCORD NOTIFICATION TRIGGERS
-- ====================================

-- Function to send Discord notification for new comments
CREATE OR REPLACE FUNCTION notify_discord_new_comment()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the Discord notification Edge Function
  PERFORM net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/discord-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_key')
    ),
    body := jsonb_build_object(
      'table', 'comments',
      'type', 'INSERT',
      'record', to_jsonb(NEW)
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to send Discord notification for comment updates (moderation)
CREATE OR REPLACE FUNCTION notify_discord_comment_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify for moderation-related changes
  IF (OLD.deleted IS DISTINCT FROM NEW.deleted) OR
     (OLD.pinned IS DISTINCT FROM NEW.pinned) OR
     (OLD.locked IS DISTINCT FROM NEW.locked) OR
     (OLD.report_count IS DISTINCT FROM NEW.report_count) THEN
    
    PERFORM net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/discord-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_key')
      ),
      body := jsonb_build_object(
        'table', 'comments',
        'type', 'UPDATE',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new comment notifications
CREATE TRIGGER discord_notify_new_comment
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION notify_discord_new_comment();

-- Create trigger for comment update notifications (moderation)
CREATE TRIGGER discord_notify_comment_update
    AFTER UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION notify_discord_comment_update();

-- Enable the necessary extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Configuration for Discord notifications
INSERT INTO config (key, value) VALUES 
    ('discord_notifications_enabled', 'true'),
    ('discord_webhook_url', ''),
    ('discord_notify_new_comments', 'true'),
    ('discord_notify_moderation', 'true'),
    ('discord_notify_reports', 'true')
ON CONFLICT (key) DO NOTHING;