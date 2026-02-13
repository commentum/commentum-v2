# Database Schema Documentation - Commentum v2 Backend

**🎯 IMPORTANT**: This database schema is part of the **Commentum v2 backend API service**. Apps integrate with this backend via API endpoints - not directly with the database.

---

## Overview

Commentum v2 uses a simplified database design with PostgreSQL and Supabase. The schema is optimized for:
- Performance with high comment volumes
- Scalability across multiple platforms
- Advanced moderation features
- Real-time voting and reporting

**Apps interact with this database through API endpoints, not direct database access.**

```
┌─────────────┐      API Calls       ┌──────────────┐
│   Your App  │ ◄─────────────────► │ Commentum v2  │
│ (Frontend)  │                       │ (Backend API)  │
└─────────────┘                       └──────────────┘
                                            │
                                            │ Database
                                            ▼
                                    PostgreSQL DB
                                    (This Schema)
```

---

## Tables

### 1. comments

The main table storing all comment data and metadata.

#### Purpose

Stores all comment-related information including:
- Comment content and structure
- User and media metadata
- Voting data
- Moderation status
- Report information
- Audit trail

#### Structure

```sql
CREATE TABLE comments (
    -- Primary identification
    id INTEGER PRIMARY KEY DEFAULT nextval('comment_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Core data (required from API calls)
    client_type TEXT NOT NULL CHECK (client_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    content TEXT NOT NULL,
    
    -- Auto-fetched user information (from platform APIs)
    username TEXT NOT NULL,
    user_avatar TEXT,
    user_role TEXT DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- Auto-fetched media information (from platform APIs)
    media_type TEXT NOT NULL CHECK (media_type IN ('anime', 'manga', 'movie', 'tv', 'other')),
    media_title TEXT NOT NULL,
    media_year INTEGER,
    media_poster TEXT,
    
    -- Comment structure
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    
    -- Comment states
    deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,
    
    pinned BOOLEAN DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,
    pinned_by TEXT,
    
    locked BOOLEAN DEFAULT FALSE,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    
    edited BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMPTZ,
    edit_count INTEGER DEFAULT 0,
    edit_history TEXT, -- JSON array
    
    -- Voting system
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    vote_score INTEGER DEFAULT 0,
    user_votes TEXT, -- JSON object
    
    -- Reporting system
    reported BOOLEAN DEFAULT FALSE,
    report_count INTEGER DEFAULT 0,
    reports TEXT, -- JSON array
    report_status TEXT DEFAULT 'none' CHECK (report_status IN ('none', 'pending', 'reviewed', 'resolved', 'dismissed')),
    
    -- Content warnings
    tags TEXT, -- JSON array
    tagged_by TEXT,
    
    -- User status
    user_banned BOOLEAN DEFAULT FALSE,
    user_muted_until TIMESTAMPTZ,
    user_shadow_banned BOOLEAN DEFAULT FALSE,
    user_warnings INTEGER DEFAULT 0,
    
    -- Moderation
    moderated BOOLEAN DEFAULT FALSE,
    moderated_at TIMESTAMPTZ,
    moderated_by TEXT,
    moderation_reason TEXT,
    moderation_action TEXT,
    
    -- System fields
    ip_address TEXT,
    user_agent TEXT,
    
    -- Constraints
    CONSTRAINT content_length CHECK (length(content) >= 1 AND length(content) <= 10000),
    CONSTRAINT username_length CHECK (length(username) >= 1 AND length(username) <= 50)
);
```

#### Column Details

##### Core Fields

| Column | Type | Description | Source | Constraints |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | Primary key with auto-increment | System | PRIMARY KEY |
| `created_at` | TIMESTAMPTZ | Comment creation timestamp | System | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | System | DEFAULT NOW() |
| `client_type` | TEXT | Platform identifier | API | NOT NULL, CHECK |
| `user_id` | TEXT | User's platform ID | API | NOT NULL |
| `media_id` | TEXT | Media identifier | API | NOT NULL |
| `content` | TEXT | Comment text | API | NOT NULL, 1-10000 chars |

##### User Information (Auto-Fetched)

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| `username` | TEXT | User's display name | Platform API |
| `user_avatar` | TEXT | Avatar URL | Platform API |
| `user_role` | TEXT | User permission level | Config |

##### Media Information (Auto-Fetched)

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| `media_type` | TEXT | Media type (anime, manga, etc.) | Platform API |
| `media_title` | TEXT | Media title | Platform API |
| `media_year` | INTEGER | Release year | Platform API |
| `media_poster` | TEXT | Poster image URL | Platform API |

**How Auto-Fetching Works:**

1. App creates comment with `user_id` and `media_id`
2. Backend fetches user info from platform API (AniList/MAL/SIMKL)
3. Backend fetches media info from platform API
4. All data stored in comment record
5. App receives complete comment with user and media data

##### Comment Structure

| Column | Type | Description | Notes |
|--------|------|-------------|-------|
| `parent_id` | INTEGER | Parent comment ID for replies | Self-referential, CASCADE DELETE |

**Nested Comments:**
- Comments can have unlimited depth (configurable)
- Replies linked via `parent_id`
- Deleting parent cascades to all replies

##### State Management

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `deleted` | BOOLEAN | Soft delete flag | FALSE |
| `deleted_at` | TIMESTAMPTZ | Deletion timestamp | NULL |
| `deleted_by` | TEXT | Who deleted comment | NULL |
| `pinned` | BOOLEAN | Pinned status | FALSE |
| `pinned_at` | TIMESTAMPTZ | Pin timestamp | NULL |
| `pinned_by` | TEXT | Who pinned comment | NULL |
| `locked` | BOOLEAN | Thread locked status | FALSE |
| `locked_at` | TIMESTAMPTZ | Lock timestamp | NULL |
| `locked_by` | TEXT | Who locked thread | NULL |

##### Edit Tracking

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `edited` | BOOLEAN | Edit status | FALSE |
| `edited_at` | TIMESTAMPTZ | Last edit timestamp | NULL |
| `edit_count` | INTEGER | Number of edits | 0 |
| `edit_history` | TEXT | JSON array of edit history | NULL |

**Edit History Format:**
```json
[
  {
    "oldContent": "Original text",
    "newContent": "Updated text",
    "editedAt": "2023-12-01T11:00:00Z",
    "editedBy": "12345"
  }
]
```

**Edit Features:**
- Users can only edit own comments
- Full edit history preserved
- Edit count tracked
- Cannot edit deleted or locked comments

##### Voting System

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `upvotes` | INTEGER | Upvote count | 0 |
| `downvotes` | INTEGER | Downvote count | 0 |
| `vote_score` | INTEGER | Net vote score | 0 |
| `user_votes` | TEXT | JSON object of user votes | NULL |

**User Votes Format:**
```json
{
  "12345": "upvote",
  "67890": "downvote"
}
```

**Voting Features:**
- Prevents self-voting
- Toggle votes (click to add, click again to remove)
- Vote score calculated as: upvotes - downvotes
- Real-time vote updates

##### Reporting System

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `reported` | BOOLEAN | Report status | FALSE |
| `report_count` | INTEGER | Number of reports | 0 |
| `reports` | TEXT | JSON array of reports | NULL |
| `report_status` | TEXT | Report review status | 'none' |

**Reports Format:**
```json
[
  {
    "id": "report-1701427200000-abc123def",
    "reporter_id": "54321",
    "reason": "spam",
    "notes": "Obvious spam content",
    "created_at": "2023-12-01T10:00:00Z",
    "status": "pending",
    "reviewed_by": null,
    "reviewed_at": null,
    "review_notes": null
  }
]
```

**Report Reasons:**
- `spam` - Automated content
- `offensive` - Offensive language
- `harassment` - Targeted harassment
- `spoiler` - Spoiler content
- `nsfw` - Not safe for work
- `off_topic` - Irrelevant content
- `other` - Other reasons

##### User Status

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `user_banned` | BOOLEAN | User ban status | FALSE |
| `user_muted_until` | TIMESTAMPTZ | Mute expiration | NULL |
| `user_shadow_banned` | BOOLEAN | Shadow ban status | FALSE |
| `user_warnings` | INTEGER | Warning count | 0 |

**User Status Features:**
- **Warning**: Increases warning count, configurable auto-mute/ban thresholds
- **Mute**: Temporary comment restriction (set expiration)
- **Ban**: Permanent comment blocking
- **Shadow Ban**: User can post, but comments hidden from others

---

### 2. config

System configuration and settings storage.

#### Purpose

Stores all system configuration as key-value pairs.

#### Structure

```sql
CREATE TABLE config (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL, -- JSON value
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Configuration Keys

| Key | Type | Default | Description |
|-----|------|----------|-------------|
| `max_comment_length` | INTEGER | 10000 | Maximum comment characters |
| `max_nesting_level` | INTEGER | 10 | Maximum reply depth |
| `rate_limit_comments_per_hour` | INTEGER | 30 | Comment rate limit |
| `rate_limit_votes_per_hour` | INTEGER | 100 | Vote rate limit |
| `rate_limit_reports_per_hour` | INTEGER | 10 | Report rate limit |
| `auto_warn_threshold` | INTEGER | 3 | Auto-warn at warnings |
| `auto_mute_threshold` | INTEGER | 5 | Auto-mute at warnings |
| `auto_ban_threshold` | INTEGER | 10 | Auto-ban at warnings |
| `super_admin_users` | JSON | [] | Super admin user IDs |
| `moderator_users` | JSON | [] | Moderator user IDs |
| `admin_users` | JSON | [] | Admin user IDs |
| `banned_keywords` | JSON | [] | Prohibited keywords |
| `system_enabled` | BOOLEAN | true | Master system toggle |
| `voting_enabled` | BOOLEAN | true | Voting system toggle |
| `reporting_enabled` | BOOLEAN | true | Reporting system toggle |
| `discord_bot_token` | STRING | "" | Discord bot token for API access |
| `discord_guild_id` | STRING | "" | Primary Discord guild ID |
| `discord_notifications_enabled` | BOOLEAN | true | Discord notifications toggle |
| `discord_notification_types` | JSON | [] | Enabled notification types |
| `anilist_client_id` | STRING | "" | AniList API client ID |
| `myanimelist_client_id` | STRING | "" | MyAnimeList client ID |
| `simkl_client_id` | STRING | "" | SIMKL client ID |

**Updating Configuration:**

```sql
-- Update comment length limit
UPDATE config SET value = '5000' WHERE key = 'max_comment_length';

-- Add moderators
UPDATE config SET value = '[123, 456, 789]' WHERE key = 'moderator_users';

-- Add banned keywords
UPDATE config SET value = '["spam", "offensive"]' WHERE key = 'banned_keywords';

-- Disable system temporarily
UPDATE config SET value = 'false' WHERE key = 'system_enabled';
```

---

### 3. discord_users

Discord bot user registration and management.

#### Purpose

Maps Discord users to platform users for moderation commands.

#### Structure

```sql
CREATE TABLE discord_users (
    id INTEGER PRIMARY KEY DEFAULT nextval('discord_users_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Discord user information
    discord_user_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    discord_discriminator TEXT,
    discord_avatar TEXT,
    
    -- Platform mapping
    platform_user_id TEXT NOT NULL,
    platform_type TEXT NOT NULL CHECK (platform_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    
    -- Role and permissions
    user_role TEXT NOT NULL DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- Registration status
    is_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Last activity
    last_command_at TIMESTAMPTZ,
    last_action_at TIMESTAMPTZ
);
```

---

### 4. discord_notifications

Discord notification delivery tracking.

#### Purpose

Logs all Discord webhook notifications for tracking and debugging.

#### Structure

```sql
CREATE TABLE discord_notifications (
    id INTEGER PRIMARY KEY DEFAULT nextval('discord_notifications_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Notification type and target
    notification_type TEXT NOT NULL,
    target_id TEXT,
    target_type TEXT,
    
    -- Related data
    comment_data TEXT,
    user_data TEXT,
    media_data TEXT,
    
    -- Discord delivery info (Bot API with Components V2)
    guild_id TEXT,
    channel_id TEXT,
    message_id TEXT,
    delivery_status TEXT DEFAULT 'pending',
    delivery_error TEXT,
    delivered_at TIMESTAMPTZ,
    
    -- Retry info
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ
);
```

---

## Indexes

### Performance Indexes

```sql
-- Core query indexes
CREATE INDEX idx_comments_client_user ON comments(client_type, user_id);
CREATE INDEX idx_comments_media ON comments(media_id, media_type);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_created ON comments(created_at);

-- Status and filtering indexes
CREATE INDEX idx_comments_deleted ON comments(deleted);
CREATE INDEX idx_comments_role ON comments(user_role);
CREATE INDEX idx_comments_report_status ON comments(report_status);
CREATE INDEX idx_comments_pinned ON comments(pinned);
CREATE INDEX idx_comments_locked ON comments(locked);
CREATE INDEX idx_comments_vote_score ON comments(vote_score);

-- User status indexes
CREATE INDEX idx_comments_user_banned ON comments(user_banned);
CREATE INDEX idx_comments_user_muted ON comments(user_muted_until);

-- Config index
CREATE INDEX idx_config_key ON config(key);

-- Discord indexes
CREATE INDEX idx_discord_users_discord_id ON discord_users(discord_user_id);
CREATE INDEX idx_discord_users_platform ON discord_users(platform_type, platform_user_id);
CREATE INDEX idx_discord_users_role ON discord_users(user_role);
CREATE INDEX idx_discord_notifications_type ON discord_notifications(notification_type);
CREATE INDEX idx_discord_notifications_status ON discord_notifications(delivery_status);
```

---

## Sequences

### Auto-increment Sequences

```sql
-- Comment ID sequence
CREATE SEQUENCE comment_id_seq START 1;

-- Config ID sequence
CREATE SEQUENCE config_id_seq START 1000;

-- Discord users sequence
CREATE SEQUENCE discord_users_seq START 1;

-- Discord notifications sequence
CREATE SEQUENCE discord_notifications_seq START 1000;
```

---

## Triggers

### Updated At Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to comments table
CREATE TRIGGER update_comments_updated_at 
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply to config table
CREATE TRIGGER update_config_updated_at 
    BEFORE UPDATE ON config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply to discord_users table
CREATE TRIGGER update_discord_users_updated_at 
    BEFORE UPDATE ON discord_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

---

## Row Level Security (RLS)

### Comments RLS Policies

```sql
-- Enable RLS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Read policy: Anyone can read non-deleted comments from non-banned users
CREATE POLICY "Anyone can read comments" ON comments
    FOR SELECT USING (
        deleted = false AND 
        user_banned = false AND 
        user_shadow_banned = false
    );

-- Insert policy: Anyone can insert comments
CREATE POLICY "Anyone can insert comments" ON comments
    FOR INSERT WITH CHECK (true);

-- Update policy: Users can update own comments, moderators can update any
CREATE POLICY "Users can update own comments" ON comments
    FOR UPDATE USING (
        auth.uid()::text = user_id OR
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Delete policy: Users can delete own comments, moderators can delete any
CREATE POLICY "Users can delete own comments" ON comments
    FOR DELETE USING (
        auth.uid()::text = user_id OR
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );
```

### Config RLS Policies

```sql
-- Enable RLS
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Read policy: Anyone can read config
CREATE POLICY "Anyone can read config" ON config
    FOR SELECT USING (true);

-- Update policy: Only admins can update config
CREATE POLICY "Admins can update config" ON config
    FOR UPDATE USING (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Insert policy: Only admins can insert config
CREATE POLICY "Admins can insert config" ON config
    FOR INSERT WITH CHECK (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Delete policy: No one can delete config
CREATE POLICY "No one can delete config" ON config
    FOR DELETE USING (false);
```

### Discord Tables RLS Policies

```sql
-- Discord users
ALTER TABLE discord_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active discord users" ON discord_users
    FOR SELECT USING (is_active = true);

CREATE POLICY "System can manage discord users" ON discord_users
    FOR ALL USING (false) WITH CHECK (false);

-- Discord notifications
ALTER TABLE discord_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can manage discord notifications" ON discord_notifications
    FOR ALL USING (false) WITH CHECK (false);
```

---

## Helper Functions

### Role Checking Function

```sql
CREATE OR REPLACE FUNCTION is_user_in_role(user_id_param TEXT, role_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    role_array JSONB;
BEGIN
    SELECT value::jsonb INTO role_array FROM config WHERE key = role_key;
    RETURN role_array @> to_jsonb(user_id_param);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Usage:**
```sql
-- Check if user is a moderator
SELECT is_user_in_role('12345', 'moderator_users');

-- RLS policy example
CREATE POLICY "Moderators can delete" ON comments
    FOR DELETE USING (
        is_user_in_role(auth.uid()::text, 'moderator_users')
    );
```

---

## Data Types and Constraints

### Enums via CHECK Constraints

- **client_type**: 'anilist', 'myanimelist', 'simkl', 'other'
- **user_role**: 'user', 'moderator', 'admin', 'super_admin'
- **media_type**: 'anime', 'manga', 'movie', 'tv', 'other'
- **report_status**: 'none', 'pending', 'reviewed', 'resolved', 'dismissed'
- **notification_type**: See Discord API docs for full list

### Data Validation

- **Content length**: 1-10,000 characters
- **Username length**: 1-50 characters
- **Integer IDs**: Positive integers only
- **JSON fields**: Valid JSON required for all JSON columns

---

## Performance Considerations

### Query Optimization

1. **Index Usage**: All major query paths are indexed
2. **Partial Indexes**: Consider for status-specific queries
3. **JSON Operations**: Use JSONB for better performance
4. **Pagination**: LIMIT/OFFSET for large result sets

### Scaling Recommendations

1. **Partitioning**: Consider by created_at for large datasets
2. **Archiving**: Move old deleted comments to archive
3. **Caching**: Cache frequently accessed config values
4. **Connection Pooling**: Use Supabase's built-in pooling

### Query Examples

```sql
-- Get comments for media (indexed)
SELECT * FROM comments
WHERE media_id = '6789' AND client_type = 'anilist'
ORDER BY created_at DESC
LIMIT 50;

-- Get user's comment history (indexed)
SELECT * FROM comments
WHERE user_id = '12345' AND client_type = 'anilist'
ORDER BY created_at DESC;

-- Get reported comments (indexed)
SELECT * FROM comments
WHERE reported = true AND report_status = 'pending'
ORDER BY created_at DESC;

-- Get top voted comments (indexed)
SELECT * FROM comments
WHERE media_id = '6789' AND deleted = false
ORDER BY vote_score DESC
LIMIT 10;
```

---

## Backup and Recovery

### Critical Data

- **comments table**: All user-generated content
- **config table**: System configuration
- **discord_users table**: Discord integrations
- **discord_notifications table**: Notification logs

### Backup Strategy

1. **Daily backups**: Automated via Supabase
2. **Point-in-time recovery**: Available for 7 days
3. **Export backups**: Weekly for long-term storage

### Disaster Recovery

1. **Restore from backup**: Use Supabase dashboard
2. **Config restoration**: Re-insert critical config values
3. **Data validation**: Verify comment counts and integrity

---

## Migration Notes

### Version 1 to Version 2

- Simplified from multi-table to single-table design
- Migrated JSON fields for better performance
- Added comprehensive indexing
- Improved RLS policies
- Added Discord integration tables

### Future Considerations

- **Full-text search**: PostgreSQL pgvector integration
- **Media attachments**: Separate table for files
- **User preferences**: Additional config options
- **Analytics**: Separate analytics table
- **Multi-language**: Translation support

---

## Important Notes

### This is a BACKEND Schema

⚠️ **IMPORTANT**: This database schema is part of the Commentum v2 backend API service.

**Apps DO NOT:**
- ❌ Connect directly to this database
- ❌ Run SQL queries against this schema
- ❌ Access tables directly

**Apps DO:**
- ✅ Make HTTP API calls to backend endpoints
- ✅ Send/receive JSON data
- ✅ Use provided REST API

**Backend DOES:**
- ✅ Manages all database operations
- ✅ Handles security and RLS
- ✅ Enforces business logic
- ✅ Provides clean API interface

### Security

- Row Level Security enabled on all tables
- API service uses service role key
- Client apps use open endpoints or platform tokens
- No direct database access for client apps

---

## Summary

This database schema provides:

- ✅ Robust comment storage with full metadata
- ✅ Efficient querying with comprehensive indexes
- ✅ Security via Row Level Security
- ✅ Flexibility via JSON columns
- ✅ Scalability for high-volume usage
- ✅ Audit trail for all operations

**The schema is managed entirely by the backend API. Apps interact via REST endpoints.**

---

For API integration, see:
- 📖 **[Complete API Reference](./COMPLETE_API_REFERENCE.md)**
- 📖 **[Quick Start Guide](./QUICK_START.md)**
