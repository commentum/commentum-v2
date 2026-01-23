# Database Schema Documentation - Commentum v2

Complete database schema reference for the Commentum v2 system.

## Overview

Commentum v2 uses a simplified two-table design with PostgreSQL and Supabase. The schema is optimized for performance, scalability, and advanced moderation features.

## Tables

### 1. comments

The main table storing all comment data and metadata.

#### Structure

```sql
CREATE TABLE comments (
    -- Primary identification
    id INTEGER PRIMARY KEY DEFAULT nextval('comment_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Core data (required from frontend)
    client_type TEXT NOT NULL CHECK (client_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    content TEXT NOT NULL,
    
    -- Auto-fetched user information
    username TEXT NOT NULL,
    user_avatar TEXT,
    user_role TEXT DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- Auto-fetched media information
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

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | INTEGER | Primary key with auto-increment | PRIMARY KEY |
| `created_at` | TIMESTAMPTZ | Comment creation timestamp | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | DEFAULT NOW() |
| `client_type` | TEXT | Platform identifier | NOT NULL, CHECK |
| `user_id` | TEXT | User's platform ID | NOT NULL |
| `media_id` | TEXT | Media identifier | NOT NULL |
| `content` | TEXT | Comment text | NOT NULL, length 1-10000 |

##### User Information

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| `username` | TEXT | User's display name | Auto-fetched from platform API |
| `user_avatar` | TEXT | Avatar URL | Auto-fetched from platform API |
| `user_role` | TEXT | User permission level | DEFAULT 'user', CHECK |

##### Media Information

| Column | Type | Description | Source |
|--------|------|-------------|--------|
| `media_type` | TEXT | Media type (anime, manga, etc.) | Auto-fetched from platform API |
| `media_title` | TEXT | Media title | Auto-fetched from platform API |
| `media_year` | INTEGER | Release year | Auto-fetched from platform API |
| `media_poster` | TEXT | Poster image URL | Auto-fetched from platform API |

##### Comment Structure

| Column | Type | Description | Notes |
|--------|------|-------------|-------|
| `parent_id` | INTEGER | Parent comment ID for replies | Self-referential, CASCADE DELETE |

##### State Management

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `deleted` | BOOLEAN | Soft delete flag | FALSE |
| `deleted_at` | TIMESTAMPTZ | Deletion timestamp | NULL |
| `deleted_by` | TEXT | Who deleted the comment | NULL |
| `pinned` | BOOLEAN | Pinned status | FALSE |
| `pinned_at` | TIMESTAMPTZ | Pin timestamp | NULL |
| `pinned_by` | TEXT | Who pinned the comment | NULL |
| `locked` | BOOLEAN | Thread locked status | FALSE |
| `locked_at` | TIMESTAMPTZ | Lock timestamp | NULL |
| `locked_by` | TEXT | Who locked the thread | NULL |

##### Edit Tracking

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `edited` | BOOLEAN | Edit status | FALSE |
| `edited_at` | TIMESTAMPTZ | Last edit timestamp | NULL |
| `edit_count` | INTEGER | Number of edits | 0 |
| `edit_history` | TEXT | JSON array of edit history | NULL |

**Edit History Format**:
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

##### Voting System

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `upvotes` | INTEGER | Upvote count | 0 |
| `downvotes` | INTEGER | Downvote count | 0 |
| `vote_score` | INTEGER | Net vote score | 0 |
| `user_votes` | TEXT | JSON object of user votes | NULL |

**User Votes Format**:
```json
{
  "12345": "upvote",
  "67890": "downvote"
}
```

##### Reporting System

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `reported` | BOOLEAN | Report status | FALSE |
| `report_count` | INTEGER | Number of reports | 0 |
| `reports` | TEXT | JSON array of reports | NULL |
| `report_status` | TEXT | Report review status | 'none' |

**Reports Format**:
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

##### Content Warnings

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `tags` | TEXT | JSON array of content tags | NULL |
| `tagged_by` | TEXT | Who added the tags | NULL |

**Tags Format**:
```json
["spoiler", "nsfw", "offensive"]
```

##### User Status

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `user_banned` | BOOLEAN | User ban status | FALSE |
| `user_muted_until` | TIMESTAMPTZ | Mute expiration | NULL |
| `user_shadow_banned` | BOOLEAN | Shadow ban status | FALSE |
| `user_warnings` | INTEGER | Warning count | 0 |

##### Moderation Tracking

| Column | Type | Description | Default |
|--------|------|-------------|---------|
| `moderated` | BOOLEAN | Moderation status | FALSE |
| `moderated_at` | TIMESTAMPTZ | Last moderation action | NULL |
| `moderated_by` | TEXT | Moderator ID | NULL |
| `moderation_reason` | TEXT | Reason for moderation | NULL |
| `moderation_action` | TEXT | Action taken | NULL |

##### System Fields

| Column | Type | Description | Notes |
|--------|------|-------------|-------|
| `ip_address` | TEXT | User's IP address | For security |
| `user_agent` | TEXT | Browser user agent | For security |

### 2. config

System configuration and settings storage.

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

| Key | Type | Description | Default |
|-----|------|-------------|---------|
| `max_comment_length` | INTEGER | Maximum comment characters | 10000 |
| `max_nesting_level` | INTEGER | Maximum reply depth | 10 |
| `rate_limit_comments_per_hour` | INTEGER | Comment rate limit | 30 |
| `rate_limit_votes_per_hour` | INTEGER | Vote rate limit | 100 |
| `rate_limit_reports_per_hour` | INTEGER | Report rate limit | 10 |
| `auto_warn_threshold` | INTEGER | Auto-warn at warnings | 3 |
| `auto_mute_threshold` | INTEGER | Auto-mute at warnings | 5 |
| `auto_ban_threshold` | INTEGER | Auto-ban at warnings | 10 |
| `super_admin_users` | JSON | Super admin user IDs | [] |
| `moderator_users` | JSON | Moderator user IDs | [] |
| `admin_users` | JSON | Admin user IDs | [] |
| `banned_keywords` | JSON | Banned keywords list | [] |
| `system_enabled` | BOOLEAN | Master system toggle | true |
| `voting_enabled` | BOOLEAN | Voting system toggle | true |
| `reporting_enabled` | BOOLEAN | Reporting system toggle | true |
| `anilist_client_id` | STRING | AniList API client ID | "" |
| `myanimelist_client_id` | STRING | MyAnimeList client ID | "" |
| `simkl_client_id` | STRING | SIMKL client ID | "" |

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
```

## Sequences

### Auto-increment Sequences

```sql
-- Comment ID sequence
CREATE SEQUENCE comment_id_seq START 1;

-- Config ID sequence
CREATE SEQUENCE config_id_seq START 1000;
```

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
```

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

## Data Types and Constraints

### Enums via CHECK Constraints

- **client_type**: 'anilist', 'myanimelist', 'simkl', 'other'
- **user_role**: 'user', 'moderator', 'admin', 'super_admin'
- **media_type**: 'anime', 'manga', 'movie', 'tv', 'other'
- **report_status**: 'none', 'pending', 'reviewed', 'resolved', 'dismissed'

### Data Validation

- **Content length**: 1-10,000 characters
- **Username length**: 1-50 characters
- **Integer IDs**: Positive integers only
- **JSON fields**: Valid JSON required for all JSON columns

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

## Backup and Recovery

### Critical Data

- **comments table**: All user-generated content
- **config table**: System configuration

### Backup Strategy

1. **Daily backups**: Automated via Supabase
2. **Point-in-time recovery**: Available for 7 days
3. **Export backups**: Weekly for long-term storage

### Disaster Recovery

1. **Restore from backup**: Use Supabase dashboard
2. **Config restoration**: Re-insert critical config values
3. **Data validation**: Verify comment counts and integrity

## Migration Notes

### Version 1 to Version 2

- Simplified from multi-table to single-table design
- Migrated JSON fields for better performance
- Added comprehensive indexing
- Improved RLS policies

### Future Considerations

- **Full-text search**: PostgreSQL pgvector integration
- **Media attachments**: Separate table for files
- **User preferences**: Additional config options
- **Analytics**: Separate analytics table

---

This schema provides a robust foundation for a scalable comment system with advanced moderation capabilities while maintaining simplicity and performance.