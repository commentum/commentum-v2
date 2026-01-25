# Complete API Reference - Commentum v2

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

**Project URL**: `https://whzwmfxngelicmjyxwmr.supabase.co`

## 🚀 Overview

Commentum v2 is a comprehensive comment system built on Supabase Edge Functions with support for multiple media platforms, advanced moderation, voting, and reporting capabilities. This API requires **no authentication keys** - all endpoints are open and use platform-specific tokens for user verification.

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Comments API](#comments-api)
3. [Votes API](#votes-api)
4. [Reports API](#reports-api)
5. [Moderation API](#moderation-api)
6. [Media API](#media-api)
7. [Discord API](#discord-api)
8. [Error Handling](#error-handling)
9. [Rate Limiting](#rate-limiting)
10. [Response Format](#response-format)

## 🔐 Authentication

### Platform Token Authentication

Most endpoints use platform-specific token verification for user authentication:

```json
{
  "client_type": "anilist|myanimelist|simkl|other",
  "user_id": "platform_user_id", 
  "token": "platform_auth_token"
}
```

#### Supported Platforms

| Platform | Token Type | Verification Method |
|----------|------------|-------------------|
| **AniList** | Bearer Token | GraphQL query to `/viewer` |
| **MyAnimeList** | Bearer Token | REST call to `/users/me` |
| **SIMKL** | API Key | REST call to `/users/settings` |
| **Other** | Custom | Custom verification logic |

#### When Authentication is Required

- **Edit/Delete Comments**: Required for users editing their own comments
- **Admin Actions**: Required for all moderation and admin operations
- **Report Resolution**: Required for resolving reports
- **Create Comments**: **NOT required** - open system

---

## 💬 Comments API

### Endpoint: `/comments`

Handles all comment-related operations (create, edit, delete).

---

### 1. Create Comment

**Method**: `POST`  
**Authentication**: Not required (open system)

#### Request Body

```json
{
  "action": "create",
  "client_type": "anilist",
  "user_id": "12345",
  "media_id": "6789", 
  "content": "This was an amazing episode!",
  "parent_id": null
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"create"` |
| `client_type` | string | ✅ | Platform: `"anilist"`, `"myanimelist"`, `"simkl"`, `"other"` |
| `user_id` | string | ✅ | User's platform ID |
| `media_id` | string | ✅ | Media identifier |
| `content` | string | ✅ | Comment text (1-10,000 characters) |
| `parent_id` | integer | ❌ | Parent comment ID for replies |

#### Response (201 Created)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "This was an amazing episode!",
    "username": "UserName",
    "user_avatar": "https://example.com/avatar.jpg",
    "user_role": "user",
    "media_type": "anime",
    "media_title": "Attack on Titan",
    "media_year": 2023,
    "media_poster": "https://example.com/poster.jpg",
    "parent_id": null,
    "created_at": "2023-12-01T10:00:00Z",
    "updated_at": "2023-12-01T10:00:00Z",
    "upvotes": 0,
    "downvotes": 0,
    "vote_score": 0,
    "user_votes": "{}",
    "deleted": false,
    "pinned": false,
    "locked": false,
    "edited": false,
    "edit_count": 0,
    "user_banned": false,
    "user_shadow_banned": false,
    "user_warnings": 0,
    "reported": false,
    "report_count": 0,
    "reports": "[]",
    "report_status": "none",
    "tags": "[]",
    "moderated": false,
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0..."
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing required fields | `client_type`, `user_id`, `media_id`, `content` required |
| 400 | Invalid content length | Content must be 1-10,000 characters |
| 400 | Maximum nesting level exceeded | Reply depth exceeds configured limit |
| 400 | Comment contains prohibited content | Banned keyword detected |
| 403 | User is banned | User account is banned |
| 403 | User is muted | User account is temporarily muted |
| 403 | Comment thread is locked | Parent comment is locked |
| 404 | Failed to fetch user information | Invalid user_id or platform API error |
| 404 | Failed to fetch media information | Invalid media_id or platform API error |
| 503 | Comment system is disabled | System disabled in configuration |

---

### 2. Edit Comment

**Method**: `POST`  
**Authentication**: Required (token verification)

#### Request Body

```json
{
  "action": "edit",
  "comment_id": 1,
  "client_type": "anilist",
  "user_id": "12345",
  "token": "user_auth_token",
  "content": "Updated comment text"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"edit"` |
| `comment_id` | integer | ✅ | ID of comment to edit |
| `client_type` | string | ✅ | Platform identifier |
| `user_id` | string | ✅ | User's platform ID |
| `token` | string | ✅ | User's auth token |
| `content` | string | ✅ | New comment content |

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "content": "Updated comment text",
    "edited": true,
    "edited_at": "2023-12-01T11:00:00Z",
    "edit_count": 1,
    "edit_history": "[{\"oldContent\":\"Original text\",\"newContent\":\"Updated text\",\"editedAt\":\"2023-12-01T11:00:00Z\",\"editedBy\":\"12345\"}]"
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Comment not found | Invalid comment_id |
| 400 | Cannot edit deleted comment | Comment is already deleted |
| 403 | Comment thread is locked | Comment is locked |
| 403 | You can only edit your own comments | User doesn't own comment |
| 401 | Authentication failed | Invalid token |

---

### 3. Delete Comment

**Method**: `POST`  
**Authentication**: Conditional (token verification for non-owners)

#### Request Body

```json
{
  "action": "delete",
  "comment_id": 1,
  "client_type": "anilist",
  "user_id": "12345",
  "token": "user_auth_token"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"delete"` |
| `comment_id` | integer | ✅ | ID of comment to delete |
| `user_id` | string | ✅ | User's platform ID |
| `client_type` | string | ❌ | Platform identifier (only needed for admin actions) |
| `token` | string | ❌ | Required only if deleting others' comments (admin only) |

#### Authentication Rules

- **Own Comment**: No token required, only `comment_id` and `user_id`
- **Others' Comment**: Token and `client_type` required (admin only)

#### Request Examples

**Delete own comment:**
```json
{
  "action": "delete",
  "comment_id": 1,
  "user_id": "12345"
}
```

**Delete others' comment (admin):**
```json
{
  "action": "delete",
  "comment_id": 1,
  "user_id": "67890",
  "client_type": "anilist",
  "token": "admin_auth_token"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "deleted": true,
    "deleted_at": "2023-12-01T12:00:00Z",
    "deleted_by": "12345"
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Comment not found | Invalid comment_id |
| 400 | Comment already deleted | Comment is already deleted |
| 401 | Token required | Token needed to delete others' comments |
| 403 | Insufficient permissions | Only admins can delete others' comments |

---

## 🗳️ Votes API

### Endpoint: `/votes`

Handles comment voting operations (upvote, downvote, remove).

---

### Vote Operations

**Method**: `POST`  
**Authentication**: Not required

#### Request Body

```json
{
  "comment_id": 1,
  "user_id": "12345",
  "vote_type": "upvote"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comment_id` | integer | ✅ | ID of comment to vote on |
| `user_id` | string | ✅ | User's platform ID |
| `vote_type` | string | ✅ | `"upvote"`, `"downvote"`, or `"remove"` |

#### Vote Logic

| Current Vote | New Vote | Result |
|--------------|----------|--------|
| None | upvote | Adds upvote |
| upvote | upvote | Removes upvote |
| downvote | upvote | Changes to upvote |
| None | downvote | Adds downvote |
| downvote | downvote | Removes downvote |
| upvote | downvote | Changes to downvote |
| Any | remove | Removes any existing vote |

#### Response (200 OK)

```json
{
  "success": true,
  "voteScore": 5,
  "upvotes": 6,
  "downvotes": 1,
  "userVote": "upvote"
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid parameters | Missing or invalid parameters |
| 400 | Invalid vote type | Must be upvote, downvote, or remove |
| 403 | Cannot vote on your own comment | Self-voting not allowed |
| 404 | Comment not found | Invalid comment_id |
| 400 | Cannot vote on deleted comment | Comment is deleted |
| 503 | Voting system is disabled | Voting disabled in configuration |

---

## 🚨 Reports API

### Endpoint: `/reports`

Handles comment reporting and moderation queue management.

---

### 1. Create Report

**Method**: `POST`  
**Authentication**: Not required

#### Request Body

```json
{
  "action": "create",
  "comment_id": 1,
  "reporter_id": "12345",
  "reason": "spam",
  "notes": "This looks like automated spam"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"create"` |
| `comment_id` | integer | ✅ | ID of comment to report |
| `reporter_id` | string | ✅ | Reporter's user ID |
| `reason` | string | ✅ | Report reason |
| `notes` | string | ❌ | Additional context |

#### Valid Reasons

- `"spam"` - Automated or repetitive content
- `"offensive"` - Offensive language or content
- `"harassment"` - Targeted harassment
- `"spoiler"` - Spoiler content without warning
- `"nsfw"` - Not safe for work content
- `"off_topic"` - Irrelevant to discussion
- `"other"` - Other reasons (specify in notes)

#### Response (201 Created)

```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "reporter_id": "12345",
    "reason": "spam",
    "notes": "This looks like automated spam",
    "created_at": "2023-12-01T10:00:00Z",
    "status": "pending"
  },
  "reportCount": 1
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid reason | Reason not in allowed list |
| 400 | Cannot report your own comment | Self-reporting not allowed |
| 400 | You have already reported this comment | Duplicate report |
| 400 | Cannot report deleted comment | Comment is deleted |
| 503 | Reporting system is disabled | Reporting disabled in configuration |

---

### 2. Resolve Report

**Method**: `POST`  
**Authentication**: Required (admin only)

#### Request Body

```json
{
  "action": "resolve",
  "comment_id": 1,
  "reporter_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "resolution": "resolved",
  "review_notes": "Confirmed spam, removed"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"resolve"` |
| `comment_id` | integer | ✅ | ID of reported comment |
| `reporter_id` | string | ✅ | Original reporter's ID |
| `client_type` | string | ✅ | Platform identifier |
| `moderator_id` | string | ✅ | Moderator's user ID |
| `token` | string | ✅ | Moderator's auth token |
| `resolution` | string | ✅ | `"resolved"` or `"dismissed"` |
| `review_notes` | string | ❌ | Moderator notes |

#### Response (200 OK)

```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "status": "resolved",
    "reviewed_by": "67890",
    "reviewed_at": "2023-12-01T11:00:00Z",
    "review_notes": "Confirmed spam, removed"
  },
  "commentId": 1,
  "newReportStatus": "resolved"
}
```

---

### 3. Get Reports Queue

**Method**: `POST`  
**Authentication**: Required (admin only)

#### Request Body

```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token"
}
```

#### Response (200 OK)

```json
{
  "reports": [
    {
      "commentId": 1,
      "content": "Spam content here",
      "author": {
        "id": "12345",
        "username": "Spammer",
        "avatar": "https://example.com/avatar.jpg"
      },
      "media": {
        "id": "6789",
        "title": "Attack on Titan",
        "type": "anime",
        "year": 2023
      },
      "createdAt": "2023-12-01T10:00:00Z",
      "reports": [
        {
          "id": "report-1701427200000-abc123def",
          "reporter_id": "54321",
          "reason": "spam",
          "notes": "Obvious spam",
          "created_at": "2023-12-01T10:00:00Z",
          "status": "pending"
        }
      ],
      "totalReports": 1,
      "reportStatus": "pending"
    }
  ],
  "total": 1
}
```

---

## 🔧 Moderation API

### Endpoint: `/moderation`

Handles advanced moderation actions (pin, lock, warn, ban, etc.).

**Authentication**: Required for all actions (admin only)

---

### Common Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Moderation action |
| `client_type` | string | ✅ | Platform identifier |
| `moderator_id` | string | ✅ | Moderator's user ID |
| `token` | string | ✅ | Moderator's auth token |

---

### 1. Pin Comment

#### Request Body

```json
{
  "action": "pin_comment",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Important announcement"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "pinned": true,
    "pinned_at": "2023-12-01T10:00:00Z",
    "pinned_by": "67890"
  },
  "action": "pinned"
}
```

---

### 2. Lock Thread

#### Request Body

```json
{
  "action": "lock_thread",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Off-topic discussion"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "locked": true,
    "locked_at": "2023-12-01T10:00:00Z",
    "locked_by": "67890"
  },
  "action": "locked"
}
```

---

### 3. Warn User

#### Request Body

```json
{
  "action": "warn_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Multiple rule violations",
  "severity": "warning",
  "duration": 24
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_user_id` | string | ✅ | User to warn |
| `reason` | string | ✅ | Warning reason |
| `severity` | string | ✅ | `"warning"`, `"mute"`, or `"ban"` |
| `duration` | integer | ❌ | Duration in hours for mutes |

#### Response (200 OK)

```json
{
  "success": true,
  "action": "warning",
  "targetUserId": "12345",
  "reason": "Multiple rule violations",
  "duration": null
}
```

---

### 4. Ban User

#### Request Body

```json
{
  "action": "ban_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Repeated spam",
  "shadow_ban": false
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_user_id` | string | ✅ | User to ban |
| `reason` | string | ✅ | Ban reason |
| `shadow_ban` | boolean | ❌ | `true` for shadow ban, `false` for regular ban |

#### Permissions

- **Admin/Super Admin**: Can ban users
- **Moderator**: Cannot ban users

#### Response (200 OK)

```json
{
  "success": true,
  "action": "banned",
  "targetUserId": "12345",
  "reason": "Repeated spam"
}
```

---

### 5. Get Moderation Queue

#### Request Body

```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token"
}
```

#### Response (200 OK)

```json
{
  "comments": [
    {
      "id": 1,
      "content": "Comment content",
      "reported": true,
      "moderated": true,
      "created_at": "2023-12-01T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

## 📺 Media API

### Endpoint: `/media`

Retrieves comments for specific media with pagination and sorting.

---

### Get Media Comments

**Method**: `GET`  
**Authentication**: Not required

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `media_id` | string | ✅ | Media identifier |
| `client_type` | string | ✅ | Platform identifier |
| `page` | integer | ❌ | Page number (default: 1) |
| `limit` | integer | ❌ | Results per page (default: 50, max: 100) |
| `sort` | string | ❌ | Sort order (default: "newest") |

#### Sort Options

| Option | Description |
|--------|-------------|
| `"newest"` | Most recent first |
| `"oldest"` | Oldest first |
| `"top"` | Highest vote score first |
| `"controversial"` | Most upvotes first |

#### Example Request

```
GET /media?media_id=6789&client_type=anilist&page=1&limit=20&sort=top
```

#### Response (200 OK)

```json
{
  "media": {
    "mediaId": "6789",
    "mediaType": "anime",
    "mediaTitle": "Attack on Titan",
    "mediaYear": 2023,
    "mediaPoster": "https://example.com/poster.jpg"
  },
  "comments": [
    {
      "id": 1,
      "content": "Great episode!",
      "username": "User123",
      "user_avatar": "https://example.com/avatar.jpg",
      "user_role": "user",
      "created_at": "2023-12-01T10:00:00Z",
      "upvotes": 10,
      "downvotes": 2,
      "vote_score": 8,
      "pinned": false,
      "locked": false,
      "edited": false,
      "replies": [
        {
          "id": 2,
          "content": "I agree!",
          "username": "User456",
          "created_at": "2023-12-01T10:30:00Z",
          "upvotes": 3,
          "downvotes": 0,
          "vote_score": 3,
          "replies": []
        }
      ]
    }
  ],
  "stats": {
    "commentCount": 150,
    "totalUpvotes": 500,
    "totalDownvotes": 50,
    "netScore": 450
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### Features

- **Nested Structure**: Comments are returned in nested reply structure
- **Filtered Content**: Automatically filters deleted comments and banned users
- **Statistics**: Includes vote statistics and pagination info
- **Media Info**: Returns media information from first comment

---

## 🤖 Discord API

### Endpoint: `/discord`

Handles Discord bot integration and slash commands.

---

### Discord Bot Features

The Discord API provides:

1. **User Registration**: Link Discord accounts to platform accounts
2. **Slash Commands**: Moderation commands via Discord
3. **Verification**: Token verification for platform accounts
4. **Notifications**: Send notifications to Discord channels

### 1. Register Discord User

#### Request Body

```json
{
  "action": "register",
  "discord_user_id": "123456789012345678",
  "discord_username": "User#1234",
  "platform_user_id": "12345",
  "platform_type": "anilist",
  "token": "platform_auth_token"
}
```

#### Response (201 Created)

```json
{
  "success": true,
  "registration": {
    "id": 1,
    "discord_user_id": "123456789012345678",
    "discord_username": "User#1234",
    "platform_user_id": "12345",
    "platform_type": "anilist",
    "user_role": "user",
    "registered_at": "2023-12-01T10:00:00Z",
    "is_active": true
  },
  "message": "Successfully registered User#1234 as user"
}
```

### 2. Discord Slash Commands

The bot supports these slash commands:

| Command | Description | Permissions |
|---------|-------------|-------------|
| `/register` | Register Discord account | All users |
| `/ban` | Ban a user | Admin/Super Admin |
| `/unban` | Unban a user | Admin/Super Admin |
| `/warn` | Warn a user | Moderator+ |
| `/mute` | Mute a user | Moderator+ |
| `/promote` | Promote user role | Super Admin |
| `/demote` | Demote user role | Super Admin |

### 3. Discord Interactions

The endpoint handles Discord interaction callbacks:

```json
{
  "type": 2,
  "data": {
    "name": "ban",
    "options": [...]
  },
  "member": {
    "user": {
      "id": "123456789012345678"
    }
  }
}
```

---

## ⚠️ Error Handling

### Standard Error Response

```json
{
  "error": "Error description"
}
```

### HTTP Status Codes

| Status | Category | Description |
|--------|----------|-------------|
| 200 | Success | Request successful |
| 201 | Created | New resource created |
| 400 | Client Error | Bad request, invalid parameters |
| 401 | Unauthorized | Authentication required/failed |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |
| 503 | Service Unavailable | System disabled |

### Common Error Scenarios

#### Authentication Errors
```json
{
  "error": "Authentication failed"
}
```

#### Permission Errors
```json
{
  "error": "Admin permissions required"
}
```

#### Validation Errors
```json
{
  "error": "comment_id must be a positive integer"
}
```

#### System Errors
```json
{
  "error": "Comment system is disabled"
}
```

---

## 🚦 Rate Limiting

### Default Rate Limits

| Action | Limit per Hour | Per User |
|--------|----------------|----------|
| Create Comments | 30 | ✅ |
| Cast Votes | 100 | ✅ |
| File Reports | 10 | ✅ |
| Edit Comments | 30 | ✅ |
| Delete Comments | 30 | ✅ |
| Moderation Actions | 100 | ❌ (global) |

### Rate Limit Response

When rate limited:

```json
{
  "error": "Rate limit exceeded"
}
```

**HTTP Status**: `429 Too Many Requests`

### Configuration

Rate limits are configurable in the `config` table:

```sql
UPDATE config SET value = '50' WHERE key = 'rate_limit_comments_per_hour';
```

---

## 📊 Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### Success with Resource

```json
{
  "success": true,
  "comment": { ... }
}
```

### Success with List

```json
{
  "reports": [ ... ],
  "total": 10
}
```

### Pagination Response

```json
{
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

---

## 🔧 Configuration

### System Configuration

All system settings are stored in the `config` table:

| Key | Default | Description |
|-----|---------|-------------|
| `system_enabled` | `"true"` | Master system toggle |
| `voting_enabled` | `"true"` | Voting system toggle |
| `reporting_enabled` | `"true"` | Reporting system toggle |
| `max_comment_length` | `"10000"` | Maximum comment characters |
| `max_nesting_level` | `"10"` | Maximum reply depth |
| `rate_limit_comments_per_hour` | `"30"` | Comment rate limit |
| `rate_limit_votes_per_hour` | `"100"` | Vote rate limit |
| `rate_limit_reports_per_hour` | `"10"` | Report rate limit |
| `banned_keywords` | `"[]""` | JSON array of banned words |
| `super_admin_users` | `"[]"` | JSON array of super admin IDs |
| `moderator_users` | `"[]"` | JSON array of moderator IDs |
| `admin_users` | `"[]"` | JSON array of admin IDs |

### Discord Configuration

| Key | Description |
|-----|-------------|
| `discord_webhook_url` | Discord webhook URL |
| `discord_bot_token` | Discord bot token |
| `discord_client_id` | Discord client ID |
| `discord_guild_id` | Discord guild ID |
| `discord_notifications_enabled` | Enable Discord notifications |

---

## 🎯 Quick Start Examples

### 1. Create a Comment

```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "Great episode!"
  }'
```

### 2. Get Media Comments

```bash
curl "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=10"
```

### 3. Vote on Comment

```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 1,
    "user_id": "12345",
    "vote_type": "upvote"
  }'
```

### 4. Report Comment

```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/reports" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "comment_id": 1,
    "reporter_id": "12345",
    "reason": "spam"
  }'
```

---

## 📝 Additional Notes

### No API Keys Required

- **No authentication needed** for basic operations
- **No service keys** required
- **No anon keys** required
- Uses platform-specific tokens for user verification only

### Security Features

- **Content Filtering**: Automatic banned keyword detection
- **User Status Management**: Ban, mute, shadow-ban capabilities
- **Rate Limiting**: Per-user rate limiting
- **Audit Trail**: Complete edit history and moderation logs
- **IP/UA Tracking**: Security monitoring

### Performance Features

- **Optimized Database**: Efficient indexing
- **Pagination**: Configurable page sizes
- **Caching**: Built-in caching for frequently accessed data
- **Nested Comments**: Efficient nested structure building

---

**Commentum v2 API Reference**  
*Complete documentation for all API endpoints*  
*Project URL: https://whzwmfxngelicmjyxwmr.supabase.co*