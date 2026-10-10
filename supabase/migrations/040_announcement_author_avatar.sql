-- Migration 040: Add author_avatar column to announcements table
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS author_avatar TEXT;
