-- Migration 041: Clean up orphaned announcement notifications and add cascade trigger

-- 1. Clean up existing orphaned notifications for already-deleted announcements
DELETE FROM notifications
WHERE type = 'announcement_published'
  AND (
    metadata->>'announcement_id' IS NULL
    OR (metadata->>'announcement_id')::INT NOT IN (SELECT id FROM announcements)
  );

-- 2. Trigger to automatically delete notifications whenever an announcement is deleted
CREATE OR REPLACE FUNCTION on_announcement_deleted()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM notifications
  WHERE type = 'announcement_published'
    AND metadata->>'announcement_id' = OLD.id::TEXT;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_announcement_notifications ON announcements;
CREATE TRIGGER trg_delete_announcement_notifications
AFTER DELETE ON announcements
FOR EACH ROW
EXECUTE FUNCTION on_announcement_deleted();
